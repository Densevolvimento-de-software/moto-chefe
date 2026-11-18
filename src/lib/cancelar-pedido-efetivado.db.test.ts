// Teste de banco do cancelar do pedido efetivado (#23, Q16): o "Cancelar venda" de qualquer venda do pedido cancela o pedido
// inteiro. Pelas actions e com a persona real; as actions gravam fora de transação de teste: cada cenário cria a própria Conta
// e só confere o que criou.
import { after, before, mock, test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { semearLoja } from '@/test/semear-conta'
import { efetivarPedidoSintetico, semearContaDoPedido, type ContaDoPedido } from '@/test/pedido-efetivado'

const url = process.env.TEST_DATABASE_URL
if (!url || !['localhost', '127.0.0.1'].includes(new URL(url).hostname)) throw new Error('Use somente Postgres descartável local')
process.env.DATABASE_URL = url

type Persona = { id: string; papel: string; lojaId: string | null; gruposAcesso: string[]; contaId: string }
let usuario: Persona

const authMock = mock.module('@/lib/auth', { namedExports: { getUsuarioLogado: async () => usuario } })
const cacheMock = mock.module('next/cache', { namedExports: { revalidatePath: () => {} } })

type Db = typeof import('@/lib/db')
type Actions = typeof import('@/app/(dashboard)/vendas/actions')
let db: Db['db']
let execRows: Db['execRows']
let actions: Actions

before(async () => {
  ;({ db, execRows } = await import('@/lib/db'))
  actions = await import('@/app/(dashboard)/vendas/actions')
})
after(async () => {
  authMock.restore()
  cacheMock.restore()
  await (globalThis as { __pgPool?: { end(): Promise<void> } }).__pgPool?.end()
})

const idDe = async (q: ReturnType<typeof sql>) => (await execRows(q))[0].id as string
const semearConta = () => semearContaDoPedido({ db, execRows }, 'CPE23')
type Conta = ContaDoPedido
const pedidoEfetivado = (c: Conta, motoIds: string[], frete = 0) =>
  efetivarPedidoSintetico({ execRows }, actions, p => { usuario = p }, c, motoIds, frete)

const saldo = async (c: Conta) =>
  Number((await execRows(sql`select quantidade from pecas_estoque_loja where peca_id = ${c.capacete} and loja_id = ${c.base.lojaId}`))[0].quantidade)

test('C1: cancelar uma venda que não é a do pagamento cancela o pedido de 3 motos: vendas, caixa, venda de peça e estoque voltam', async () => {
  const c = await semearConta()
  const motoIds = await c.motos(3)
  const p = await pedidoEfetivado(c, motoIds, 300)
  assert.equal(await saldo(c), 3)
  const outra = p.vendaDa(motoIds[2])
  assert.notEqual(outra, p.vendaDoPagamento)

  const r = await actions.cancelarVendaCompletaAction(outra, 'Cliente desistiu')

  assert.deepEqual(r, { ok: true, cartao: 0, pix: 0, demandas: 0, valor: 0, documentosAssinados: 0 })
  assert.deepEqual(await execRows(sql`select id from vendas where pedido_venda_id = ${p.pedidoId}`), [])
  assert.deepEqual(await execRows(sql`select distinct status::text, disponibilidade::text from motos where id in ${motoIds}`),
    [{ status: 'montada', disponibilidade: 'disponivel' }])
  assert.deepEqual(await execRows(sql`select status from pedidos_venda where id = ${p.pedidoId}`), [{ status: 'cancelado' }])
  assert.deepEqual(await execRows(sql`select id from lancamentos_caixa where venda_id = ${p.vendaDoPagamento}`), [])
  assert.deepEqual(await execRows(sql`select id from vendas_pecas where pedido_venda_id = ${p.pedidoId}`), [])
  assert.equal(await saldo(c), 5)
  const cancelamentos = await execRows(sql`select moto_id from historico_estoque where moto_id in ${motoIds} and status_novo = 'montada'`)
  assert.deepEqual(cancelamentos.map(h => h.moto_id).sort(), [...motoIds].sort())
  const logs = await execRows(sql`select detalhe->>'vendaId' as venda, detalhe->>'motivo' as motivo from log_acoes
    where tipo = 'venda_cancelada' and detalhe->>'vendaId' in ${p.vendaIds}`)
  assert.deepEqual(logs.map(l => [l.venda, l.motivo]).sort(), p.vendaIds.map(id => [id, 'Cliente desistiu']).sort())
})

test('C2: pedido de 1 moto com acessório: a venda de peça sai junto e o saldo volta', async () => {
  const c = await semearConta()
  const [m] = await c.motos(1)
  const p = await pedidoEfetivado(c, [m])
  assert.equal(await saldo(c), 3)

  assert.equal((await actions.cancelarVendaCompletaAction(p.vendaDa(m), 'Lançada errada')).ok, true)

  assert.deepEqual(await execRows(sql`select id from vendas_pecas where pedido_venda_id = ${p.pedidoId}`), [])
  assert.equal(await saldo(c), 5)
  assert.deepEqual(await execRows(sql`select status from pedidos_venda where id = ${p.pedidoId}`), [{ status: 'cancelado' }])
})

test('C4: cartão e PIX conciliados com a venda do pagamento ficam soltos; o retorno soma o que foi solto no pedido', async () => {
  const c = await semearConta()
  const motoIds = await c.motos(2)
  const p = await pedidoEfetivado(c, motoIds)
  const cartao = await idDe(sql`insert into conciliacoes_cartao (grupo_id, operadora, data_transacao, valor_bruto, venda_id, conciliado, conciliado_em)
    values (${c.base.grupoId}, 'stone', '2026-11-05', 300.50, ${p.vendaDoPagamento}, true, now()) returning id`)
  const pix = await idDe(sql`insert into pix_recebimentos_mcp (grupo_id, conta_id, banco, transacao_id, data, valor, venda_id, tipo_correspondencia, lancado_por_id, lancado_em)
    values (${c.base.grupoId}, 'conta-sintetica', 'banco', ${randomUUID()}, now(), 200.25, ${p.vendaDoPagamento}, 'venda', ${c.auxId}, now()) returning id`)
  usuario = c.socio

  const r = await actions.cancelarVendaCompletaAction(p.vendaDa(motoIds.find(m => p.vendaDa(m) !== p.vendaDoPagamento)!), 'Financiamento negado')

  assert.deepEqual(r, { ok: true, cartao: 1, pix: 1, demandas: 0, valor: 500.75, documentosAssinados: 0 })
  assert.deepEqual(await execRows(sql`select venda_id, conciliado from conciliacoes_cartao where id = ${cartao}`), [{ venda_id: null, conciliado: false }])
  assert.deepEqual(await execRows(sql`select venda_id from pix_recebimentos_mcp where id = ${pix}`), [{ venda_id: null }])
})

/** NF de saída na venda dada; `Processando` na produção é uma emissão em andamento (status.ts). */
const nfNaVenda = (c: Conta, vendaId: string, ambiente: string, status: string) =>
  execRows(sql`insert into notas_fiscais_saida (venda_id, venda_numero, grupo_id, id_externo, ambiente, status, payload)
    select ${vendaId}, numero, ${c.base.grupoId}, ${randomUUID()}, ${ambiente}, ${status}, '{}'::jsonb from vendas where id = ${vendaId}`)

const vendasQueFicam = async (pedidoId: string) => (await execRows(sql`select id from vendas where pedido_venda_id = ${pedidoId}`)).length

test('C5: NF de produção em emissão numa OUTRA venda do pedido trava o cancelar de qualquer uma; nada é apagado', async () => {
  const c = await semearConta()
  const motoIds = await c.motos(2)
  const p = await pedidoEfetivado(c, motoIds)
  const [comNf, clicada] = [p.vendaDa(motoIds[0]), p.vendaDa(motoIds[1])]
  await nfNaVenda(c, comNf, 'Producao', 'Processando')
  usuario = c.socio

  const r = await actions.cancelarVendaCompletaAction(clicada, 'Cliente desistiu')

  assert.equal(r.ok, false)
  assert.equal('travada' in r && r.travada, true)
  assert.equal(await vendasQueFicam(p.pedidoId), 2)
  assert.equal(await saldo(c), 3)
  assert.deepEqual(await execRows(sql`select status from pedidos_venda where id = ${p.pedidoId}`), [{ status: 'efetivado' }])
})

test('C6: NF de homologação ou cancelada numa venda do pedido não trava: o pedido inteiro cancela', async () => {
  const c = await semearConta()
  for (const [ambiente, status] of [['Homologacao', 'Autorizada'], ['Producao', 'Cancelada']]) {
    const motoIds = await c.motos(2)
    const p = await pedidoEfetivado(c, motoIds)
    await nfNaVenda(c, p.vendaDa(motoIds[0]), ambiente, status)
    usuario = c.socio
    assert.equal((await actions.cancelarVendaCompletaAction(p.vendaDa(motoIds[1]), 'Teste')).ok, true, `${ambiente} ${status}`)
    assert.equal(await vendasQueFicam(p.pedidoId), 0)
  }
})

test('C7: aux_adm não cancela o pedido se OUTRA venda dele tem número de NF preenchido (#191); o sócio cancela', async () => {
  const c = await semearConta()
  const motoIds = await c.motos(2)
  const p = await pedidoEfetivado(c, motoIds)
  await execRows(sql`update vendas set nota_fiscal_saida = '4321' where id = ${p.vendaDa(motoIds[0])}`)
  usuario = c.aux

  assert.deepEqual(await actions.cancelarVendaCompletaAction(p.vendaDa(motoIds[1]), 'Teste'), {
    ok: false, travada: true,
    error: 'Esta venda tem NF registrada (nº 4321). Cancelar venda com nota fiscal fica com os administradores; fale com o Cesar.',
  })
  assert.equal(await vendasQueFicam(p.pedidoId), 2)

  usuario = c.socio
  assert.equal((await actions.cancelarVendaCompletaAction(p.vendaDa(motoIds[1]), 'Teste')).ok, true)
  assert.equal(await vendasQueFicam(p.pedidoId), 0)
})

test('C8: Conta B não cancela o pedido da A: mesma frase do id inexistente; nada muda na A', async () => {
  const a = await semearConta()
  const b = await semearConta()
  const motoIds = await a.motos(2)
  const p = await pedidoEfetivado(a, motoIds)
  usuario = b.aux

  const daOutraConta = await actions.cancelarVendaCompletaAction(p.vendaDa(motoIds[1]), 'Teste')
  assert.deepEqual(daOutraConta, { ok: false, error: 'Venda não encontrada' })
  assert.deepEqual(await actions.cancelarVendaCompletaAction(randomUUID(), 'Teste'), daOutraConta)
  assert.equal(await vendasQueFicam(p.pedidoId), 2)
  assert.equal(await saldo(a), 3)
})

test('C9: vendedor e aux_adm de outra loja da Conta não cancelam; nada muda', async () => {
  const c = await semearConta()
  const motoIds = await c.motos(2)
  const p = await pedidoEfetivado(c, motoIds)
  const outraLoja = await semearLoja(db, c.base.grupoId, `CPE23 outra ${randomUUID()}`)

  usuario = c.vendedor
  assert.deepEqual(await actions.cancelarVendaCompletaAction(p.vendaDa(motoIds[1]), 'Teste'),
    { ok: false, error: 'Apenas administradores, sócios e auxiliares administrativos podem cancelar vendas' })
  usuario = { ...c.aux, lojaId: outraLoja }
  assert.deepEqual(await actions.cancelarVendaCompletaAction(p.vendaDa(motoIds[1]), 'Teste'),
    { ok: false, error: 'Sem permissão para cancelar venda de outra loja' })
  assert.equal(await vendasQueFicam(p.pedidoId), 2)
})

test('C10: a venda que veio de reserva volta como hoje: a reserva convertida fica, as motos voltam a disponível', async () => {
  const c = await semearConta()
  const motoIds = await c.motos(2)
  const p = await pedidoEfetivado(c, motoIds)
  const reservaId = await idDe(sql`insert into reservas (moto_id, loja_id, vendedor_id, valor_reserva, meio_pagamento, data_prevista_finalizacao, status)
    values (${motoIds[1]}, ${c.base.lojaId}, ${c.auxId}, 500, 'pix', '2026-12-01', 'convertida') returning id`)
  await execRows(sql`update vendas set reserva_id = ${reservaId} where id = ${p.vendaDa(motoIds[1])}`)
  usuario = c.aux

  assert.equal((await actions.cancelarVendaCompletaAction(p.vendaDa(motoIds[0]), 'Teste')).ok, true)
  assert.deepEqual(await execRows(sql`select status from reservas where id = ${reservaId}`), [{ status: 'convertida' }])
  assert.deepEqual(await execRows(sql`select distinct disponibilidade::text from motos where id in ${motoIds}`), [{ disponibilidade: 'disponivel' }])
})
