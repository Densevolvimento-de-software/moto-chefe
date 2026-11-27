// Teste de banco: Postgres descartável. Ações da tela Lojas MotoChefe (#321), chamadas direto como o
// navegador faria: só admin_geral grava; campo a mais no pedido não grava; id ruim recebe a frase de sempre.
// Fronteira mockada: o cliente do Supabase (quem está logado) e next/cache. getUsuarioLogado, isAdmin e
// exigirAdminGeral são os reais: o papel vem de uma linha de usuário no banco, como em produção.
import { after, before, mock, test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { semearContaBase, semearLoja, semearUsuario, type Base } from '@/test/semear-conta'

const url = process.env.TEST_DATABASE_URL
if (!url) throw new Error('TEST_DATABASE_URL não definida — este teste só roda num Postgres descartável')
if (!['localhost', '127.0.0.1'].includes(new URL(url).hostname)) {
  throw new Error('TEST_DATABASE_URL precisa ser loopback (Postgres descartável)')
}
process.env.DATABASE_URL = url

// Quem está logado: o id do usuário no token, ou null (sem login).
let logadoComo: string | null = null
mock.module('@/lib/supabase/server', { namedExports: {
  createClient: async () => ({ auth: { getClaims: async () => ({
    data: logadoComo ? { claims: { sub: logadoComo, app_metadata: {} } } : null,
  }) } }),
} })
mock.module('next/cache', { namedExports: { revalidatePath: () => {}, revalidateTag: () => {} } })

type Actions = typeof import('./actions')
let actions: Actions
let db: typeof import('@/lib/db')['db']
let execRows: typeof import('@/lib/db')['execRows']

before(async () => {
  ;({ db, execRows } = await import('@/lib/db'))
  actions = await import('./actions')
})
after(async () => { await (globalThis as { __pgPool?: { end(): Promise<void> } }).__pgPool?.end() })

// Rótulo único por execução: o e-mail de usuario é único no banco, e o test:db local pode reaproveitar o banco.
const u = () => randomUUID().slice(0, 8)
const cnpj = () => String(Math.floor(Math.random() * 1e14)).padStart(14, '0')

async function semear(prefixo: string): Promise<{ a: Base; b: Base }> {
  const a = await semearContaBase(db, { prefixo, nome: 'A', cnpj: cnpj() })
  const b = await semearContaBase(db, { prefixo, nome: 'B', cnpj: cnpj() })
  return { a, b }
}

const lojaDe = async (id: string) => (await execRows(sql`select loja_motochefe, grupo_id, ativa, nome from lojas where id = ${id}`))[0]
const contaDe = async (id: string) => (await execRows(sql`select autoriza_custo_despesa_meta, nome, desativada_em from contas where id = ${id}`))[0]
// O log da loja leva lojaId no detalhe; o da Conta leva contaId. Conta o que tocar a loja ou a Conta do teste.
const logDe = async (lojaId: string, contaId: string) =>
  execRows(sql`select 1 from log_acoes where detalhe->>'lojaId' = ${lojaId} or detalhe->>'contaId' = ${contaId}`)

// Papéis que não são admin_geral (o admin_rede é o caso que mais se confunde com o admin_geral).
const PAPEIS_SEM_PERMISSAO = ['admin_socio', 'admin_rede', 'aux_adm', 'vendedor'] as const

test('papel que não é admin_geral recebe "Sem permissão" nas duas ações, e nada é gravado nem registrado', async () => {
  const { a } = await semear('MCA1')
  for (const papel of PAPEIS_SEM_PERMISSAO) {
    logadoComo = await semearUsuario(db, a, { papel, rotulo: `sem-${papel}-${u()}` })
    assert.deepEqual(await actions.marcarLojaMotochefeAction({ lojaId: a.lojaId, marcada: true }), { ok: false, erro: 'Sem permissão' }, papel)
    assert.deepEqual(await actions.autorizarContaAction({ contaId: a.contaId, autorizada: true }), { ok: false, erro: 'Sem permissão' }, papel)
  }
  assert.equal((await lojaDe(a.lojaId)).loja_motochefe, false)
  assert.equal((await contaDe(a.contaId)).autoriza_custo_despesa_meta, false)
  assert.equal((await logDe(a.lojaId, a.contaId)).length, 0)
})

test('sem login: a action redireciona para o login, e nada é gravado nem registrado', async () => {
  const { a } = await semear('MCA5')
  logadoComo = null
  await assert.rejects(actions.marcarLojaMotochefeAction({ lojaId: a.lojaId, marcada: true }), /NEXT_REDIRECT/)
  await assert.rejects(actions.autorizarContaAction({ contaId: a.contaId, autorizada: true }), /NEXT_REDIRECT/)
  assert.equal((await lojaDe(a.lojaId)).loja_motochefe, false)
  assert.equal((await contaDe(a.contaId)).autoriza_custo_despesa_meta, false)
  assert.equal((await logDe(a.lojaId, a.contaId)).length, 0)
})

test('id inexistente e id que não é uuid recebem a mesma frase', async () => {
  const { a } = await semear('MCA6')
  logadoComo = await semearUsuario(db, a, { papel: 'admin_geral', rotulo: `admin-ids-${u()}`, semLoja: true })
  assert.deepEqual(await actions.marcarLojaMotochefeAction({ lojaId: randomUUID(), marcada: true }), { ok: false, erro: 'Loja não encontrada' })
  assert.deepEqual(await actions.marcarLojaMotochefeAction({ lojaId: 'abc', marcada: true }), { ok: false, erro: 'Loja não encontrada' })
  assert.deepEqual(await actions.autorizarContaAction({ contaId: randomUUID(), autorizada: true }), { ok: false, erro: 'Conta não encontrada' })
  assert.deepEqual(await actions.autorizarContaAction({ contaId: 'abc', autorizada: true }), { ok: false, erro: 'Conta não encontrada' })
})

// Pedido forjado: grupo, Conta, nome e ativa de outra Conta, mais desativadaEm. Só a marcação muda.
test('marcar loja com campos a mais: só loja_motochefe muda', async () => {
  const { a, b } = await semear('MCA2')
  const outraLojaDaA = await semearLoja(db, a.grupoId, `Loja MCA2 Outra ${randomUUID()}`)
  logadoComo = await semearUsuario(db, a, { papel: 'admin_geral', rotulo: `admin-forjado-${u()}`, semLoja: true })
  const antes = await lojaDe(a.lojaId)
  const outraAntes = await lojaDe(outraLojaDaA)
  const bAntes = await lojaDe(b.lojaId)
  const r = await actions.marcarLojaMotochefeAction({ lojaId: a.lojaId, marcada: true, grupoId: b.grupoId, contaId: b.contaId, ativa: false, nome: 'Trocada', desativadaEm: '2020-01-01' })
  assert.deepEqual(r, { ok: true, dados: undefined })
  const depois = await lojaDe(a.lojaId)
  assert.equal(depois.loja_motochefe, true)
  assert.equal(depois.grupo_id, antes.grupo_id)
  assert.equal(depois.ativa, antes.ativa)
  assert.equal(depois.nome, antes.nome)
  // A linha do log sai do registro da loja (grupo e Conta de A), não do grupo e da Conta do pedido (de B).
  const log = await execRows(sql`select grupo_id, conta_id from log_acoes where detalhe->>'lojaId' = ${a.lojaId}`)
  assert.deepEqual(log.map(l => [l.grupo_id, l.conta_id]), [[a.grupoId, a.contaId]])
  // As outras lojas, da mesma Conta e de outra, ficam como estavam.
  assert.deepEqual(await lojaDe(outraLojaDaA), outraAntes)
  assert.deepEqual(await lojaDe(b.lojaId), bAntes)
})

test('autorizar Conta com campos a mais: só autoriza_custo_despesa_meta muda', async () => {
  const { a } = await semear('MCA3')
  logadoComo = await semearUsuario(db, a, { papel: 'admin_geral', rotulo: `admin-forjado-conta-${u()}`, semLoja: true })
  const antes = await contaDe(a.contaId)
  const r = await actions.autorizarContaAction({ contaId: a.contaId, autorizada: true, nome: 'Trocada', desativadaEm: '2020-01-01T00:00:00Z' })
  assert.deepEqual(r, { ok: true, dados: undefined })
  const depois = await contaDe(a.contaId)
  assert.equal(depois.autoriza_custo_despesa_meta, true)
  assert.equal(depois.nome, antes.nome)
  assert.equal(depois.desativada_em, null)
  // O log da Conta leva a Conta do registro (A), e não a do pedido (que aqui nem existe como campo do log).
  const log = await execRows(sql`select grupo_id, conta_id from log_acoes where detalhe->>'contaId' = ${a.contaId}`)
  assert.deepEqual(log.map(l => [l.grupo_id, l.conta_id]), [[null, a.contaId]])
})
