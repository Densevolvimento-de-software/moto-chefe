// Teste de banco: ações da chave da API (#322), chamadas direto como o navegador faria. Só admin_geral grava; campo
// a mais no pedido não tem efeito; a chave nova sai só no retorno. Fronteira mockada: o login (Supabase) e next/cache.
// A chave é uma só para o sistema: este arquivo grava e revoga de verdade, por isso roda sozinho (test:db, segundo
// node --test). O after apaga o que ele criou. Cada teste começa com as chaves do sistema revogadas.
import { after, before, mock, test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { NextRequest } from 'next/server'
import { sha256 } from '@/lib/assinatura/hash'
import { FRASE_CHAVE_TROCADA_AGORA, FRASE_JA_TEM_CHAVE, FRASE_SEM_CHAVE } from '@/lib/api-leitura'
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
// Falha da revalidação da tela, depois da gravação: o teste liga e desliga.
let revalidaFalha = false
mock.module('next/cache', { namedExports: {
  revalidatePath: () => { if (revalidaFalha) throw new Error('revalidação falhou') },
  revalidateTag: () => {},
} })

type Actions = typeof import('./actions')
type Rota = typeof import('@/app/api/v1/lojas/route')
let db: typeof import('@/lib/db')['db']
let execRows: typeof import('@/lib/db')['execRows']
let apiChaves: typeof import('@/lib/db/schema')['apiChaves']
let actions: Actions
let consulta: typeof import('@/lib/queries/api-leitura')
let GET: Rota['GET']
let esperarRegistros: () => Promise<void>

const u = () => randomUUID().slice(0, 8)
const cnpj = () => String(Math.floor(Math.random() * 1e14)).padStart(14, '0')
const HORA = 60 * 60 * 1000

let base: Base
let adminId: string

before(async () => {
  ;({ esperarRegistros } = await mockAfterDaResposta())
  ;({ db, execRows } = await import('@/lib/db'))
  ;({ apiChaves } = await import('@/lib/db/schema'))
  actions = await import('./actions')
  consulta = await import('@/lib/queries/api-leitura')
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

// Estado zero, direto no banco (não é ação, então não gera log): nenhuma chave não revogada no sistema.
const zerarChaves = () => db.execute(sql`update api_chaves set revogada_em = now() where revogada_em is null`)
const chavesDoAdmin = () => execRows(sql`select id, valida_ate, revogada_em from api_chaves where gerada_por = ${adminId}`)
const naoRevogadasDoAdmin = () => execRows(sql`select 1 from api_chaves where gerada_por = ${adminId} and revogada_em is null`)
const atuaisDoAdmin = () => execRows(sql`select 1 from api_chaves where gerada_por = ${adminId} and valida_ate is null and revogada_em is null`)
const logsDoAdmin = () => execRows(sql`select tipo, detalhe, grupo_id, conta_id from log_acoes where usuario_id = ${adminId} order by criado_em, id`)
const apagarLogsDoAdmin = () => db.execute(sql`delete from log_acoes where usuario_id = ${adminId}`)

// Espera, sem relógio fixo, até outra sessão ficar presa numa trava do Postgres (a corrida acontece de verdade).
async function esperarBloqueio(): Promise<void> {
  for (let i = 0; i < 200; i++) {
    const [linha] = await execRows(sql`select count(*)::int as n from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock'`)
    if (linha.n > 0) return
    await new Promise(r => setTimeout(r, 25))
  }
  throw new Error('nenhuma sessão ficou esperando trava em 5 segundos')
}

test('sem login: as três ações mandam para o login', async () => {
  logadoComo = null
  try {
    await assert.rejects(actions.gerarChaveAction(), /NEXT_REDIRECT/)
    await assert.rejects(actions.trocarChaveAction(), /NEXT_REDIRECT/)
    await assert.rejects(actions.revogarChaveAction(), /NEXT_REDIRECT/)
  } finally {
    logadoComo = adminId
  }
})

test('papel que não é admin_geral recebe "Sem permissão" nas três ações, e não grava chave nem registro', async () => {
  for (const papel of ['admin_socio', 'admin_rede', 'aux_adm', 'vendedor'] as const) {
    const id = await semearUsuario(db, base, { papel, rotulo: `sem-${papel}-${u()}` })
    logadoComo = id
    try {
      assert.deepEqual(await actions.gerarChaveAction(), { ok: false, erro: 'Sem permissão' }, papel)
      assert.deepEqual(await actions.trocarChaveAction(), { ok: false, erro: 'Sem permissão' }, papel)
      assert.deepEqual(await actions.revogarChaveAction(), { ok: false, erro: 'Sem permissão' }, papel)
      assert.equal((await execRows(sql`select 1 from api_chaves where gerada_por = ${id}`)).length, 0, papel)
      assert.equal((await execRows(sql`select 1 from log_acoes where usuario_id = ${id}`)).length, 0, papel)
    } finally {
      logadoComo = adminId
    }
  }
})

// As ações não recebem argumento: o que vier a mais do navegador é ignorado. A chave nova fica sem validade e com o dono certo.
test('pedido com campos a mais: a chave nova não recebe validade, hash nem outro dono', async () => {
  await zerarChaves()
  const outro = randomUUID()
  const comCampos = actions.gerarChaveAction as unknown as (entrada: unknown) => ReturnType<Actions['gerarChaveAction']>
  const resposta = await comCampos({ validaAte: new Date(Date.now() + 365 * 24 * HORA), hash: 'x', geradaPor: outro })
  assert.equal(resposta.ok, true)
  assert.equal((await atuaisDoAdmin()).length, 1)
  assert.equal((await execRows(sql`select 1 from api_chaves where gerada_por = ${outro}`)).length, 0)
  assert.equal((await execRows(sql`select 1 from api_chaves where hash = 'x'`)).length, 0)
})

test('gerar sem chave: devolve a chave, e a API aceita a chave devolvida', async () => {
  await zerarChaves()
  const resposta = await actions.gerarChaveAction()
  assert.equal(resposta.ok, true)
  if (!resposta.ok) return
  assert.match(resposta.dados.chave, /^[A-Za-z0-9_-]{43}$/)
  assert.equal((await chamarApi(resposta.dados.chave)).status, 200)
})

test('gerar com chave ativa: recusa com a frase fixa, e nada muda (chave nem registro)', async () => {
  await zerarChaves()
  assert.equal((await actions.gerarChaveAction()).ok, true)
  const chavesAntes = (await chavesDoAdmin()).length
  const logsAntes = (await logsDoAdmin()).length
  assert.deepEqual(await actions.gerarChaveAction(), { ok: false, erro: FRASE_JA_TEM_CHAVE })
  assert.equal((await chavesDoAdmin()).length, chavesAntes)
  assert.equal((await logsDoAdmin()).length, logsAntes)
})

test('trocar sem chave ativa: recusa com a frase fixa, sem chave nova e sem registro', async () => {
  await zerarChaves()
  const chavesAntes = (await chavesDoAdmin()).length
  const logsAntes = (await logsDoAdmin()).length
  assert.deepEqual(await actions.trocarChaveAction(), { ok: false, erro: FRASE_SEM_CHAVE })
  assert.equal((await chavesDoAdmin()).length, chavesAntes)
  assert.equal((await logsDoAdmin()).length, logsAntes)
})

// Fluxo na ordem que a pessoa faria: gerar; trocar (a antiga vale 24h); a antiga passa a 23h e depois a 25h; revogar.
// A recusa de 25h e a de revogada são iguais, e o log sai exato: gerada, trocada, revogada com as 2 chaves tiradas.
test('fluxo: gerar, trocar e revogar: a API aceita e recusa como deve, e o log sai exato', async () => {
  await zerarChaves()
  await apagarLogsDoAdmin()
  const gerada = await actions.gerarChaveAction()
  assert.equal(gerada.ok, true)
  if (!gerada.ok) return
  const primeira = gerada.dados.chave
  assert.equal((await chamarApi(primeira)).status, 200, 'a chave gerada passa')

  const trocada = await actions.trocarChaveAction()
  assert.equal(trocada.ok, true)
  if (!trocada.ok) return
  const segunda = trocada.dados.chave
  assert.equal((await chamarApi(primeira)).status, 200, 'a anterior, trocada agora, ainda passa')
  assert.equal((await chamarApi(segunda)).status, 200, 'a nova passa')

  await db.execute(sql`update api_chaves set valida_ate = now() + interval '1 hour' where hash = ${sha256(primeira)}`)
  assert.equal((await chamarApi(primeira)).status, 200, 'trocada há 23h passa')

  await db.execute(sql`update api_chaves set valida_ate = now() - interval '1 hour' where hash = ${sha256(primeira)}`)
  const recusaCom25h = await chamarApi(primeira)
  assert.equal(recusaCom25h.status, 401)

  assert.deepEqual(await actions.revogarChaveAction(), { ok: true, dados: undefined })
  const recusaRevogada = await chamarApi(segunda)
  assert.deepEqual(recusaRevogada, recusaCom25h, 'revogada e trocada há mais de 24h recebem a mesma resposta')

  const logs = await logsDoAdmin()
  assert.deepEqual(logs.map(l => l.tipo), ['api_chave_gerada', 'api_chave_trocada', 'api_chave_revogada'])
  assert.deepEqual(logs.map(l => l.detalhe), [{}, {}, { revogadas: 2 }])
  for (const l of logs) {
    assert.equal(l.grupo_id, null)
    assert.equal(l.conta_id, null)
  }
  const texto = JSON.stringify(logs)
  for (const chave of [primeira, segunda]) {
    assert.equal(texto.includes(chave), false, 'a chave saiu no log')
    assert.equal(texto.includes(sha256(chave)), false, 'o hash saiu no log')
  }
})

test('revogar sem chave ativa: nada muda e nada é registrado, também na segunda chamada', async () => {
  await zerarChaves()
  await apagarLogsDoAdmin()
  const chavesAntes = (await chavesDoAdmin()).length
  assert.deepEqual(await actions.revogarChaveAction(), { ok: true, dados: undefined })
  assert.deepEqual(await actions.revogarChaveAction(), { ok: true, dados: undefined })
  assert.equal((await chavesDoAdmin()).length, chavesAntes)
  assert.equal((await logsDoAdmin()).length, 0)
})

test('revogada não volta a valer: uma chave nova não reabre a antiga', async () => {
  await zerarChaves()
  const primeira = (await actions.gerarChaveAction())
  assert.equal(primeira.ok, true)
  if (!primeira.ok) return
  assert.deepEqual(await actions.revogarChaveAction(), { ok: true, dados: undefined })
  const recusaAntiga = await chamarApi(primeira.dados.chave)
  assert.equal(recusaAntiga.status, 401)

  const nova = await actions.gerarChaveAction()
  assert.equal(nova.ok, true)
  if (!nova.ok) return
  assert.equal((await chamarApi(nova.dados.chave)).status, 200, 'a chave nova passa')
  assert.deepEqual(await chamarApi(primeira.dados.chave), recusaAntiga, 'a revogada continua recusada, com a mesma resposta')
})

// Ordem fixa, sem depender de sorte: a troca fica aberta (com a chave antiga travada e a nova ainda não commitada)
// enquanto a revogação chega e espera. Quando a troca termina, a revogação não pode deixar a chave nova valendo.
test('revogação que espera uma troca em curso: a chave que a troca gravou também sai', async () => {
  await zerarChaves()
  assert.equal((await actions.gerarChaveAction()).ok, true)
  let revogacao: Promise<number> | undefined
  let novaChave = ''
  await db.transaction(async tx => {
    const troca = await consulta.trocarChaveAtual({ geradaPor: adminId, agora: new Date() }, tx)
    assert.equal(troca.ok, true)
    if (!troca.ok) return
    novaChave = troca.chave
    revogacao = consulta.revogarChaves(new Date())
    await esperarBloqueio()
  })
  await revogacao
  assert.equal((await naoRevogadasDoAdmin()).length, 0, 'nenhuma chave segue valendo')
  assert.equal((await chamarApi(novaChave)).status, 401, 'a chave que a troca gravou está revogada')
})

// Troca e revogação ao mesmo tempo: a ordem entre elas não é fixa, mas em qualquer ordem nenhuma chave não revogada
// sobra, e a chave de antes não volta.
test('troca e revogação ao mesmo tempo: no fim nenhuma chave segue valendo', async () => {
  await zerarChaves()
  const gerada = await actions.gerarChaveAction()
  assert.equal(gerada.ok, true)
  if (!gerada.ok) return
  assert.match(gerada.dados.chave, /^[A-Za-z0-9_-]{43}$/)
  const [trocada] = await Promise.all([actions.trocarChaveAction(), actions.revogarChaveAction()])
  assert.equal((await naoRevogadasDoAdmin()).length, 0)
  assert.equal((await chamarApi(gerada.dados.chave)).status, 401, 'a chave de antes está revogada')
  if (trocada.ok) assert.equal((await chamarApi(trocada.dados.chave)).status, 401, 'a chave trocada também foi revogada')
})

// Dois gerar ao mesmo tempo: a trava põe um depois do outro. O segundo vê a chave do primeiro e recebe a frase fixa.
test('dois gerar ao mesmo tempo: um dá certo e o outro recebe a frase de que já existe chave', async () => {
  await zerarChaves()
  const respostas = await Promise.all([actions.gerarChaveAction(), actions.gerarChaveAction()])
  assert.equal(respostas.filter(r => r.ok).length, 1)
  assert.deepEqual(respostas.filter(r => !r.ok), [{ ok: false, erro: FRASE_JA_TEM_CHAVE }])
  assert.equal((await atuaisDoAdmin()).length, 1)
})

// Duas trocas ao mesmo tempo: a trava põe uma depois da outra. A primeira deixa a chave antiga no prazo; a segunda
// tira o prazo dela e põe a sua atual. No fim, uma atual e uma no prazo, a antiga revogada, e as duas novas aceitas.
test('duas trocas ao mesmo tempo: sobra uma atual e uma no prazo, e a chave antiga não volta', async () => {
  await zerarChaves()
  const gerada = await actions.gerarChaveAction()
  assert.equal(gerada.ok, true)
  if (!gerada.ok) return
  const trocas = await Promise.all([actions.trocarChaveAction(), actions.trocarChaveAction()])
  assert.ok(trocas.every(t => t.ok), 'as duas trocas deram certo')
  assert.equal((await atuaisDoAdmin()).length, 1)
  assert.equal((await naoRevogadasDoAdmin()).length, 2, 'uma atual e uma no prazo')
  assert.equal((await chamarApi(gerada.dados.chave)).status, 401, 'a chave antiga está revogada')
  for (const troca of trocas) {
    if (troca.ok) assert.equal((await chamarApi(troca.dados.chave)).status, 200, 'cada chave nova passa')
  }
})

// Corrida pelo índice: uma linha de chave atual é inserida por fora da ação e fica sem commit. A ação não passa pela
// trava dela (a outra transação não a pegou), tenta gravar, espera o índice e, quando a outra termina, recebe a frase
// da corrida. Prova o caminho de segurança e que sobra uma só atual. Pela trava da ação, dois gerar em paralelo caem
// no teste de "já existe" acima, então esta frase só aparece com a linha de fora.
test('corrida de gerar: a segunda ação recebe a frase de recarregar, e sobra uma só chave atual', async () => {
  await zerarChaves()
  let pendente: Promise<unknown> | undefined
  await db.transaction(async tx => {
    await tx.insert(apiChaves).values({ hash: sha256(randomUUID()), geradaPor: adminId })
    pendente = actions.gerarChaveAction()
    await esperarBloqueio()
  })
  assert.deepEqual(await pendente, { ok: false, erro: FRASE_CHAVE_TROCADA_AGORA })
  assert.equal((await atuaisDoAdmin()).length, 1)
})

test('revalidar a tela falha depois da gravação: a chave nova ainda sai, sem frase de erro', async () => {
  await zerarChaves()
  revalidaFalha = true
  try {
    const resposta = await actions.gerarChaveAction()
    assert.equal(resposta.ok, true, resposta.ok ? '' : resposta.erro)
    if (!resposta.ok) return
    assert.equal((await chamarApi(resposta.dados.chave)).status, 200, 'a chave gerada passa')
  } finally {
    revalidaFalha = false
  }
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
