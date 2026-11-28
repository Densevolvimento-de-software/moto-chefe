// Teste de banco: ações da chave da API (#322), chamadas direto como o navegador faria. Só admin_geral grava; campo a
// mais no pedido não tem efeito; a chave nova sai só no retorno. Fronteira mockada: o login (Supabase) e next/cache.
// As ações gravam de verdade (a chave é uma só para o sistema, por isso o teste não usa transação que se desfaz):
// o after apaga o que este arquivo criou. A chamada à API passa pela rota real, com a chave que a ação devolveu.
import { after, before, mock, test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { NextRequest } from 'next/server'
import { FRASE_CHAVE_TROCADA_AGORA, FRASE_ERRO_GERAR } from '@/lib/api-leitura'
import { mockAfterDaResposta } from '@/test/after-resposta'
import { apagarContasSemeadas, semearContaBase, semearUsuario, type Base } from '@/test/semear-conta'

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
type Rota = typeof import('@/app/api/v1/lojas/route')
let db: typeof import('@/lib/db')['db']
let execRows: typeof import('@/lib/db')['execRows']
let actions: Actions
let GET: Rota['GET']
let esperarRegistros: () => Promise<void>


const u = () => randomUUID().slice(0, 8)
const cnpj = () => String(Math.floor(Math.random() * 1e14)).padStart(14, '0')
const sha = (texto: string) => createHash('sha256').update(texto).digest('hex')
const HORA = 60 * 60 * 1000

let base: Base
let adminId: string
// Chaves que o fluxo principal gera; os testes seguintes leem as mesmas (rodam em ordem dentro do arquivo).
let primeira = ''
let segunda = ''

before(async () => {
  ;({ esperarRegistros } = await mockAfterDaResposta())
  ;({ db, execRows } = await import('@/lib/db'))
  actions = await import('./actions')
  ;({ GET } = await import('@/app/api/v1/lojas/route'))
  base = await semearContaBase(db, { prefixo: 'API322', nome: 'Conta API322', cnpj: cnpj() })
  adminId = await semearUsuario(db, base, { papel: 'admin_geral', rotulo: `admin-322-${u()}`, semLoja: true })
  logadoComo = adminId
})

// Chamada à rota real: a resposta inteira (status e corpo), para comparar recusas.
async function chamarApi(chave: string) {
  const headers = new Headers({ authorization: `Bearer ${chave}`, 'user-agent': `chave-322-${randomUUID()}`, 'x-forwarded-for': '200.1.2.3' })
  const resposta = await GET(new NextRequest('http://localhost/api/v1/lojas', { headers }))
  return { status: resposta.status, corpo: await resposta.json() as unknown }
}

const chavesDoAdmin = (condicao = sql`true`) => execRows(sql`select valida_ate, revogada_em from api_chaves where gerada_por = ${adminId} and ${condicao}`)
const logsDoAdmin = () => execRows(sql`select tipo, detalhe, grupo_id, conta_id from log_acoes where usuario_id = ${adminId} order by criado_em, id`)

test('sem login: as duas ações mandam para o login', async () => {
  logadoComo = null
  await assert.rejects(actions.gerarOuTrocarChaveAction(), /NEXT_REDIRECT/)
  await assert.rejects(actions.revogarChaveAction(), /NEXT_REDIRECT/)
  logadoComo = adminId
})

test('papel que não é admin_geral recebe "Sem permissão" nas duas ações, e não grava chave nem registro', async () => {
  for (const papel of ['admin_socio', 'admin_rede', 'aux_adm', 'vendedor'] as const) {
    const id = await semearUsuario(db, base, { papel, rotulo: `sem-${papel}-${u()}` })
    logadoComo = id
    assert.deepEqual(await actions.gerarOuTrocarChaveAction(), { ok: false, erro: 'Sem permissão' }, papel)
    assert.deepEqual(await actions.revogarChaveAction(), { ok: false, erro: 'Sem permissão' }, papel)
    assert.equal((await execRows(sql`select 1 from api_chaves where gerada_por = ${id}`)).length, 0, papel)
    assert.equal((await execRows(sql`select 1 from log_acoes where usuario_id = ${id}`)).length, 0, papel)
  }
  logadoComo = adminId
})

// As ações não recebem argumento: o que vier a mais do navegador é ignorado. A chave nova fica sem validade e com o dono certo.
test('pedido com campos a mais: a chave nova não recebe validade, hash nem outro dono', async () => {
  const outro = randomUUID()
  const comCampos = actions.gerarOuTrocarChaveAction as unknown as (entrada: unknown) => ReturnType<Actions['gerarOuTrocarChaveAction']>
  const resposta = await comCampos({ validaAte: new Date(Date.now() + 365 * 24 * HORA), hash: 'x', geradaPor: outro })
  assert.equal(resposta.ok, true)
  const atuais = await chavesDoAdmin(sql`valida_ate is null and revogada_em is null`)
  assert.equal(atuais.length, 1)
  assert.equal((await execRows(sql`select 1 from api_chaves where gerada_por = ${outro}`)).length, 0)
  assert.equal((await execRows(sql`select 1 from api_chaves where hash = 'x'`)).length, 0)
})

// Fluxo principal, na ordem que a pessoa faria: gerar, a API aceita; trocar, a antiga vale 24h; a antiga passa a 25h
// trocada ou sai pela revogação: a API recusa das duas formas com a mesma resposta.
test('gerar e trocar: a chave passa na API; trocada há 23h passa; trocada há 25h e revogada recebem a mesma resposta', async () => {
  const gerada = await actions.gerarOuTrocarChaveAction()
  assert.equal(gerada.ok, true)
  if (!gerada.ok) return
  primeira = gerada.dados.chave
  assert.equal((await chamarApi(primeira)).status, 200, 'a chave gerada passa')

  const trocada = await actions.gerarOuTrocarChaveAction()
  assert.equal(trocada.ok, true)
  if (!trocada.ok) return
  segunda = trocada.dados.chave
  assert.equal((await chamarApi(primeira)).status, 200, 'a anterior, trocada agora, ainda passa')
  assert.equal((await chamarApi(segunda)).status, 200, 'a nova passa')

  await db.execute(sql`update api_chaves set valida_ate = now() + interval '1 hour' where hash = ${sha(primeira)}`)
  assert.equal((await chamarApi(primeira)).status, 200, 'trocada há 23h passa')

  await db.execute(sql`update api_chaves set valida_ate = now() - interval '1 hour' where hash = ${sha(primeira)}`)
  const recusaCom25h = await chamarApi(primeira)

  assert.deepEqual(await actions.revogarChaveAction(), { ok: true, dados: undefined })
  const recusaRevogada = await chamarApi(segunda)
  assert.equal(recusaCom25h.status, 401)
  assert.deepEqual(recusaRevogada, recusaCom25h, 'revogada e trocada há mais de 24h recebem a mesma resposta')
})

test('gerar, trocar e revogar entram no log de ações sem a chave nem o hash dela', async () => {
  const logs = await logsDoAdmin()
  const tipos = logs.map(l => l.tipo)
  assert.ok(tipos.includes('api_chave_gerada') || tipos.includes('api_chave_trocada'), 'entrada de gerar ou trocar no log')
  assert.ok(tipos.includes('api_chave_revogada'), 'revogação no log')
  for (const l of logs) {
    assert.equal(l.grupo_id, null)
    assert.equal(l.conta_id, null)
  }
  const texto = JSON.stringify(logs)
  for (const chave of [primeira, segunda]) {
    assert.equal(texto.includes(chave), false, 'a chave saiu no log')
    assert.equal(texto.includes(sha(chave)), false, 'o hash saiu no log')
  }
})

// Duas gerações ao mesmo tempo: cada resposta é a chave ou uma das duas frases; no fim, só uma chave atual do admin.
// Não garante que a corrida aconteça; garante o que cada caminho devolve e que não sobram duas atuais.
test('duas gerações ao mesmo tempo: cada resposta é chave ou frase conhecida, e sobra uma só chave atual', async () => {
  const respostas = await Promise.all([actions.gerarOuTrocarChaveAction(), actions.gerarOuTrocarChaveAction()])
  for (const r of respostas) {
    if (r.ok) assert.match(r.dados.chave, /^[A-Za-z0-9_-]{43}$/)
    else assert.ok([FRASE_CHAVE_TROCADA_AGORA, FRASE_ERRO_GERAR].includes(r.erro), r.erro)
  }
  assert.equal((await chavesDoAdmin(sql`valida_ate is null and revogada_em is null`)).length, 1)
})

after(async () => {
  await esperarRegistros()
  const deAdmin = sql`(select id from api_chaves where gerada_por = ${adminId})`
  await db.execute(sql`delete from api_acessos where chave_id in ${deAdmin}`)
  await db.execute(sql`delete from api_limite where chave_id in ${deAdmin}`)
  await db.execute(sql`delete from api_chaves where gerada_por = ${adminId}`)
  await db.execute(sql`delete from log_acoes where usuario_id = ${adminId}`)
  await apagarContasSemeadas(db, { contaIds: [base.contaId], prefixo: 'API322' })
  await (globalThis as { __pgPool?: { end(): Promise<void> } }).__pgPool?.end()
})
