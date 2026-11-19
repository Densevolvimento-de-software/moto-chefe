// Teste de banco: importação da maquininha Mercado Pago de um grupo (#51), contra o Postgres descartável.
// Só a API do Mercado Pago (a rede) é simulada, pelo `buscar` injetado; credencial, casamento, gravação e
// estorno rodam de verdade. A importação abre a própria transação, então cada cenário cria as próprias
// Contas e ids de pagamento e só olha o que é dele.
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { randomInt, randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { semearContaBase, semearModelo, semearUsuario } from '@/test/semear-conta'
import { semearVendaMoto, type Pagamentos } from '@/test/semear-alvos-conciliacao'
import type { PagamentoMp } from './point'
import credito3x from '@/test/mercadopago-sintetico/credito-3x.json'
import creditoEstornado from '@/test/mercadopago-sintetico/credito-estornado.json'
import debito from '@/test/mercadopago-sintetico/debito.json'
import pixFixture from '@/test/mercadopago-sintetico/pix.json'

const url = process.env.TEST_DATABASE_URL
if (!url || !['localhost', '127.0.0.1'].includes(new URL(url).hostname)) throw new Error('Use somente Postgres descartável local')
process.env.DATABASE_URL = url
process.env.CERT_MASTER_KEY ??= 'c'.repeat(64)

let db: typeof import('@/lib/db')['db']
let execRows: typeof import('@/lib/db')['execRows']
let mod: typeof import('./importar')
let cifrar: typeof import('@/lib/cripto')['cifrar']
let RecusaUsuario: typeof import('@/lib/resultado-action')['RecusaUsuario']
let ErroMercadoPago: typeof import('./cliente')['ErroMercadoPago']

before(async () => {
  ;({ db, execRows } = await import('@/lib/db'))
  mod = await import('./importar')
  ;({ cifrar } = await import('@/lib/cripto'))
  ;({ RecusaUsuario } = await import('@/lib/resultado-action'))
  ;({ ErroMercadoPago } = await import('./cliente'))
})
after(async () => {
  await (globalThis as { __pgPool?: { end(): Promise<void> } }).__pgPool?.end()
})

// A fixture aprova em 2026-11-10 (Brasília); a venda é do mesmo dia.
const NO_DIA = '2026-11-10 12:00:00-03'

async function semearConta(nome: string, { comCredencial = true } = {}) {
  const suf = randomUUID()
  const base = await semearContaBase(db, { prefixo: 'MPIMP', nome: `${nome} ${suf}`, cnpj: suf })
  const usuarioId = await semearUsuario(db, base, { papel: 'aux_adm' })
  const modeloId = await semearModelo(db, 'MPIMP ' + suf)
  const token = `TEST-token-${suf}`
  if (comCredencial) {
    await db.execute(sql`insert into mercadopago_config (grupo_id, token, user_id) values (${base.grupoId}, ${cifrar(token)}, ${'mp-' + suf})`)
  }
  return { ...base, usuarioId, modeloId, token, em: NO_DIA }
}
type Conta = Awaited<ReturnType<typeof semearConta>>

const venda = (c: Conta, pagamentos: Pagamentos) => semearVendaMoto(db, c, pagamentos)
const CREDITO_DA_FIXTURE: Pagamentos = [{ tipo: 'cartao_credito', valor: 900, parcelas: 3 }]

// Ids únicos por cenário: os arquivos do test:db rodam em paralelo no mesmo banco.
const novoId = () => randomInt(2_000_000_000, 2 ** 47)
const pg = (f: unknown, o: Partial<PagamentoMp> = {}): PagamentoMp => ({ ...(f as PagamentoMp), ...o })
const aprovado = (f: unknown, id: number) =>
  pg(f, { id, status: 'approved', status_detail: 'accredited', transaction_amount_refunded: 0, transaction_details: { net_received_amount: 194 } })

const AGORA = new Date('2026-11-12T12:00:00.000Z')
const buscarFixo = (pagamentos: PagamentoMp[]) => async () => pagamentos
const importar = (c: Conta, pagamentos: PagamentoMp[]) =>
  mod.importarMercadoPagoDoGrupo(c.grupoId, { agora: AGORA, buscar: buscarFixo(pagamentos) })

const NADA = { conciliadas: 0, pendentes: 0, duplicadas: 0, estornos: 0, estornosSemLinha: 0, naoTratados: 0, ignorados: 0 }

async function linhasDoGrupo(grupoId: string) {
  return execRows(sql`select nsu, tipo, status, conciliado, venda_id, valor_bruto::float as bruto, valor_liquido::float as liquido
    from conciliacoes_cartao where grupo_id = ${grupoId} and operadora = 'mercadopago' order by nsu`)
}

test('grava o cartão e casa com a venda do grupo, com o token só deste grupo', async () => {
  const a = await semearConta('A')
  await semearConta('B')
  const vendaId = await venda(a, CREDITO_DA_FIXTURE)
  const id = novoId()
  let chamada: { token: string; inicio: Date; fim: Date } | undefined
  const r = await mod.importarMercadoPagoDoGrupo(a.grupoId, {
    agora: AGORA,
    buscar: async (token, p) => { chamada = { token, ...p }; return [pg(credito3x, { id })] },
  })
  assert.deepEqual(r, { ...NADA, conciliadas: 1 })
  assert.equal(chamada?.token, a.token)
  assert.equal(chamada?.fim.toISOString(), AGORA.toISOString())
  assert.equal(chamada?.inicio.toISOString(), '2026-11-05T12:00:00.000Z')
  assert.deepEqual(await linhasDoGrupo(a.grupoId), [
    { nsu: String(id), tipo: 'credito', status: 'aprovado', conciliado: true, venda_id: vendaId, bruto: 900, liquido: 868.5 },
  ])
  const [{ em }] = await execRows(sql`select conciliado_em as em from conciliacoes_cartao where grupo_id = ${a.grupoId}`)
  assert.equal(new Date(String(em)).toISOString(), AGORA.toISOString())
})

test('casa pela autorização quando o valor não bate; a Conta B não acha a venda de A pela mesma autorização', async () => {
  const a = await semearConta('A')
  const b = await semearConta('B')
  // R$ 905 fica fora da tolerância do valor (fixture 900): só a autorização da fixture (123456) liga.
  const vendaId = await venda(a, [{ tipo: 'cartao_credito', valor: 905, parcelas: 3, autorizacao: credito3x.authorization_code }])
  const id = novoId()
  assert.deepEqual(await importar(a, [pg(credito3x, { id })]), { ...NADA, conciliadas: 1 })
  assert.equal((await linhasDoGrupo(a.grupoId))[0].venda_id, vendaId)

  assert.deepEqual(await importar(b, [pg(credito3x, { id })]), { ...NADA, pendentes: 1 })
  assert.equal((await linhasDoGrupo(b.grupoId))[0].venda_id, null)
})

// Código de autorização de 6 caracteres se repete com o tempo: a importação só casa pela autorização na janela do
// valor (±1 dia). Aqui a venda antiga é de 40 dias antes; as bordas da janela são as do casamento por valor.
test('autorização igual numa venda antiga do grupo não casa; a venda do dia com a mesma autorização casa', async () => {
  const a = await semearConta('A')
  const autorizacao = credito3x.authorization_code
  const antiga = await semearVendaMoto(db, { ...a, em: '2026-10-01 12:00:00-03' }, [{ tipo: 'cartao_credito', valor: 905, parcelas: 3, autorizacao }])
  const id = novoId()
  assert.deepEqual(await importar(a, [pg(credito3x, { id })]), { ...NADA, pendentes: 1 })
  assert.equal((await linhasDoGrupo(a.grupoId))[0].venda_id, null)

  const doDia = await venda(a, [{ tipo: 'cartao_credito', valor: 905, parcelas: 3, autorizacao }])
  const outro = novoId()
  assert.deepEqual(await importar(a, [pg(credito3x, { id: outro })]), { ...NADA, conciliadas: 1 })
  const [linha] = await execRows(sql`select venda_id from conciliacoes_cartao where grupo_id = ${a.grupoId} and nsu = ${String(outro)}`)
  assert.equal(linha.venda_id, doDia)
  assert.notEqual(doDia, antiga)
})

test('Pix da maquininha vira linha pix com o valor líquido e casa com o pagamento Pix da venda', async () => {
  const a = await semearConta('A')
  const vendaId = await venda(a, [{ tipo: 'pix', valor: 80 }])
  const id = novoId()
  assert.deepEqual(await importar(a, [pg(pixFixture, { id })]), { ...NADA, conciliadas: 1 })
  assert.deepEqual(await linhasDoGrupo(a.grupoId), [
    { nsu: String(id), tipo: 'pix', status: 'aprovado', conciliado: true, venda_id: vendaId, bruto: 80, liquido: 79.5 },
  ])
})

test('débito às 23h30 de Brasília grava no dia de Brasília, 1 parcela, e casa com o débito da venda', async () => {
  const a = await semearConta('A')
  const vendaId = await venda(a, [{ tipo: 'cartao_debito', valor: 150 }])
  const id = novoId()
  // 02:30Z do dia 11 = 23:30 do dia 10 em Brasília.
  assert.deepEqual(await importar(a, [pg(debito, { id, date_approved: '2026-11-11T02:30:00.000Z' })]), { ...NADA, conciliadas: 1 })
  const [linha] = await execRows(sql`select data_transacao::text as dia, tipo, parcelas, venda_id from conciliacoes_cartao
    where grupo_id = ${a.grupoId} and nsu = ${String(id)}`)
  assert.deepEqual(linha, { dia: '2026-11-10', tipo: 'debito', parcelas: 1, venda_id: vendaId })
})

test('segunda rodada não duplica nem desfaz o vínculo', async () => {
  const a = await semearConta('A')
  await venda(a, CREDITO_DA_FIXTURE)
  const pagamentos = [pg(credito3x, { id: novoId() }), pg(pixFixture, { id: novoId() })]
  await importar(a, pagamentos)
  const antes = await linhasDoGrupo(a.grupoId)
  assert.deepEqual(await importar(a, pagamentos), { ...NADA, duplicadas: 2 })
  assert.deepEqual(await linhasDoGrupo(a.grupoId), antes)
})

test('estorno: a linha fica estornada, não conciliada e ligada à venda, e não conta de novo', async () => {
  const a = await semearConta('A')
  const vendaId = await venda(a, [{ tipo: 'cartao_credito', valor: 200, parcelas: 1 }])
  const id = novoId()
  await importar(a, [aprovado(creditoEstornado, id)])
  assert.equal((await linhasDoGrupo(a.grupoId))[0].conciliado, true)

  // O segundo estorno nunca foi aprovado aqui (aprovado e estornado antes da rodada): não há linha, mas aparece no resumo.
  const estornos = [pg(creditoEstornado, { id }), pg(creditoEstornado, { id: novoId() })]
  assert.deepEqual(await importar(a, estornos), { ...NADA, estornos: 1, estornosSemLinha: 1 })
  const [linha] = await linhasDoGrupo(a.grupoId)
  assert.deepEqual([linha.status, linha.conciliado, linha.venda_id], ['estornado', false, vendaId])
  // Como os outros caminhos que desconciliam (desvincular, apagar venda): sem data de conciliação.
  const [{ em }] = await execRows(sql`select conciliado_em as em from conciliacoes_cartao where grupo_id = ${a.grupoId} and nsu = ${String(id)}`)
  assert.equal(em, null)

  // A linha já estornada não conta de novo como estorno: já estava aqui.
  assert.deepEqual(await importar(a, estornos), { ...NADA, duplicadas: 1, estornosSemLinha: 1 })
})

test('estorno do Pix da maquininha marca a linha pix pela mesma chave', async () => {
  const a = await semearConta('A')
  const vendaId = await venda(a, [{ tipo: 'pix', valor: 80 }])
  const id = novoId()
  await importar(a, [pg(pixFixture, { id })])
  assert.deepEqual(await importar(a, [pg(pixFixture, { id, status: 'refunded', status_detail: 'refunded' })]), { ...NADA, estornos: 1 })
  const [linha] = await linhasDoGrupo(a.grupoId)
  assert.deepEqual([linha.tipo, linha.status, linha.conciliado, linha.venda_id], ['pix', 'estornado', false, vendaId])
})

test('isolamento: Conta B não casa com a venda de A, não estorna a linha de A e o mesmo nsu vira uma linha em cada', async () => {
  const a = await semearConta('A')
  const b = await semearConta('B')
  await venda(a, [{ tipo: 'cartao_credito', valor: 200, parcelas: 1 }])
  const id = novoId()
  await importar(a, [aprovado(creditoEstornado, id)])
  const deA = await linhasDoGrupo(a.grupoId)
  assert.equal(deA[0].conciliado, true)

  assert.deepEqual(await importar(b, [aprovado(creditoEstornado, id)]), { ...NADA, pendentes: 1 })
  const [deB] = await linhasDoGrupo(b.grupoId)
  assert.deepEqual([deB.nsu, deB.venda_id, deB.conciliado], [String(id), null, false])

  await importar(b, [pg(creditoEstornado, { id })])
  assert.deepEqual(await linhasDoGrupo(a.grupoId), deA)
  assert.equal((await linhasDoGrupo(b.grupoId))[0].status, 'estornado')
})

test('grupo sem credencial e grupo inexistente: a mesma frase, sem chamar o Mercado Pago', async () => {
  const semCredencial = await semearConta('A', { comCredencial: false })
  for (const grupoId of [semCredencial.grupoId, randomUUID()]) {
    let chamou = false
    await assert.rejects(
      mod.importarMercadoPagoDoGrupo(grupoId, { agora: AGORA, buscar: async () => { chamou = true; return [] } }),
      (e: unknown) => e instanceof RecusaUsuario && e.message === 'Este grupo não tem credencial do Mercado Pago.',
    )
    assert.equal(chamou, false)
  }
})

test('credencial recusada (401) não grava nada', async () => {
  const a = await semearConta('A')
  await venda(a, CREDITO_DA_FIXTURE)
  await assert.rejects(
    mod.importarMercadoPagoDoGrupo(a.grupoId, {
      agora: AGORA,
      buscar: async () => { throw new ErroMercadoPago('Credencial do Mercado Pago recusada (HTTP 401). Cadastre o token novo.', 401) },
    }),
    (e: unknown) => e instanceof ErroMercadoPago && e.status === 401,
  )
  assert.deepEqual(await linhasDoGrupo(a.grupoId), [])
})

test('pré-pago e pagamento sem valor líquido contam como não tratados e não gravam; link de pagamento é ignorado', async () => {
  const a = await semearConta('A')
  const r = await importar(a, [
    pg(debito, { id: novoId(), payment_type_id: 'prepaid_card' }),
    pg(pixFixture, { id: novoId(), transaction_details: {} }),
    pg(credito3x, { id: novoId(), point_of_interaction: { type: 'CHECKOUT' } }),
  ])
  assert.deepEqual(r, { ...NADA, naoTratados: 2, ignorados: 1 })
  assert.deepEqual(await linhasDoGrupo(a.grupoId), [])
})

test('grupos da rodada: só os que têm credencial e estão ativos', async () => {
  const comCredencial = await semearConta('A')
  const semCredencial = await semearConta('B', { comCredencial: false })
  const inativo = await semearConta('C')
  await db.execute(sql`update grupos set ativo = false where id = ${inativo.grupoId}`)
  const ids = (await mod.gruposComMercadoPago()).map(g => g.id)
  assert.equal(ids.includes(comCredencial.grupoId), true)
  assert.equal(ids.includes(semCredencial.grupoId), false)
  assert.equal(ids.includes(inativo.grupoId), false)
})
