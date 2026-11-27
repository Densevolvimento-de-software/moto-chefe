// Teste de banco: Postgres descartável. Ações da tela Lojas MotoChefe (#321), chamadas direto como o
// navegador faria: só admin_geral grava; campo a mais no pedido não grava; id ruim recebe a frase de sempre.
// Fronteira mockada: sessão e next/cache. Os dados ficam no banco (a action grava pelo `db`), por isso
// cada teste cria a sua semente com um prefixo só dele.
import { after, before, mock, test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { semearContaBase, type Base } from '@/test/semear-conta'

const url = process.env.TEST_DATABASE_URL
if (!url) throw new Error('TEST_DATABASE_URL não definida — este teste só roda num Postgres descartável')
if (!['localhost', '127.0.0.1'].includes(new URL(url).hostname)) {
  throw new Error('TEST_DATABASE_URL precisa ser loopback (Postgres descartável)')
}
process.env.DATABASE_URL = url

let sessao: Record<string, unknown> = {}
mock.module('@/lib/auth', { namedExports: {
  getUsuarioLogado: async () => sessao,
  isAdmin: (papel: string) => papel === 'admin_geral',
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

const cnpj = () => String(Math.floor(Math.random() * 1e14)).padStart(14, '0')
const ADMIN = { id: randomUUID(), nome: 'Admin', email: 'admin@teste.invalid', papel: 'admin_geral' }

async function semear(prefixo: string): Promise<{ a: Base; b: Base }> {
  const a = await semearContaBase(db, { prefixo, nome: 'A', cnpj: cnpj() })
  const b = await semearContaBase(db, { prefixo, nome: 'B', cnpj: cnpj() })
  return { a, b }
}

const lojaDe = async (id: string) => (await execRows(sql`select loja_motochefe, grupo_id, ativa, nome from lojas where id = ${id}`))[0]
const contaDe = async (id: string) => (await execRows(sql`select autoriza_custo_despesa_meta, nome, desativada_em from contas where id = ${id}`))[0]
const logDaLoja = async (id: string) => execRows(sql`select 1 from log_acoes where detalhe->>'lojaId' = ${id}`)

test('papel que não é admin_geral recebe "Sem permissão" nas duas ações, e nada é gravado nem registrado', async () => {
  const { a } = await semear('MCA1')
  for (const papel of ['admin_socio', 'aux_adm', 'vendedor']) {
    sessao = { ...ADMIN, id: randomUUID(), papel }
    assert.deepEqual(await actions.marcarLojaMotochefeAction({ lojaId: a.lojaId, marcada: true }), { ok: false, erro: 'Sem permissão' }, papel)
    assert.deepEqual(await actions.autorizarContaAction({ contaId: a.contaId, autorizada: true }), { ok: false, erro: 'Sem permissão' }, papel)
  }
  assert.equal((await lojaDe(a.lojaId)).loja_motochefe, false)
  assert.equal((await contaDe(a.contaId)).autoriza_custo_despesa_meta, false)
  assert.equal((await logDaLoja(a.lojaId)).length, 0)
})

test('id inexistente e id que não é uuid recebem a mesma frase', async () => {
  sessao = { ...ADMIN }
  assert.deepEqual(await actions.marcarLojaMotochefeAction({ lojaId: randomUUID(), marcada: true }), { ok: false, erro: 'Loja não encontrada' })
  assert.deepEqual(await actions.marcarLojaMotochefeAction({ lojaId: 'abc', marcada: true }), { ok: false, erro: 'Loja não encontrada' })
  assert.deepEqual(await actions.autorizarContaAction({ contaId: randomUUID(), autorizada: true }), { ok: false, erro: 'Conta não encontrada' })
  assert.deepEqual(await actions.autorizarContaAction({ contaId: 'abc', autorizada: true }), { ok: false, erro: 'Conta não encontrada' })
})

// Pedido forjado: grupo, Conta, nome e ativa de outra Conta, mais desativadaEm. Só a marcação muda.
test('marcar loja com campos a mais: só loja_motochefe muda', async () => {
  const { a, b } = await semear('MCA2')
  sessao = { ...ADMIN }
  const antes = await lojaDe(a.lojaId)
  const r = await actions.marcarLojaMotochefeAction({ lojaId: a.lojaId, marcada: true, grupoId: b.grupoId, contaId: b.contaId, ativa: false, nome: 'Trocada', desativadaEm: '2020-01-01' })
  assert.deepEqual(r, { ok: true, dados: undefined })
  const depois = await lojaDe(a.lojaId)
  assert.equal(depois.loja_motochefe, true)
  assert.equal(depois.grupo_id, antes.grupo_id)
  assert.equal(depois.ativa, antes.ativa)
  assert.equal(depois.nome, antes.nome)
})

test('autorizar Conta com campos a mais: só autoriza_custo_despesa_meta muda', async () => {
  const { a } = await semear('MCA3')
  sessao = { ...ADMIN }
  const antes = await contaDe(a.contaId)
  const r = await actions.autorizarContaAction({ contaId: a.contaId, autorizada: true, nome: 'Trocada', desativadaEm: '2020-01-01T00:00:00Z' })
  assert.deepEqual(r, { ok: true, dados: undefined })
  const depois = await contaDe(a.contaId)
  assert.equal(depois.autoriza_custo_despesa_meta, true)
  assert.equal(depois.nome, antes.nome)
  assert.equal(depois.desativada_em, null)
})
