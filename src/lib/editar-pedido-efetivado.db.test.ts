// Teste de banco do Editar do pedido efetivado (#23, Q17): a edição vale para todas as vendas do pedido e para a venda de peça;
// com NF valendo, cliente e valores não mudam e o pagamento sim. Pelas actions e com a persona real; cada cenário cria a
// própria Conta e só confere o que criou.
import { after, before, mock, test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { CPF_SINTETICO, efetivarPedidoSintetico, semearContaDoPedido, type ContaDoPedido } from '@/test/pedido-efetivado'
import { SOMA_PAGAMENTOS_DIFERE } from '@/lib/pagamentos-entrada'

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

const OK = { ok: true, dados: undefined }
const recusa = (erro: string) => ({ ok: false, erro })
const semearConta = () => semearContaDoPedido({ db, execRows }, 'EPE23')
const pedidoEfetivado = (c: ContaDoPedido, motoIds: string[], frete = 0) =>
  efetivarPedidoSintetico({ execRows }, actions, p => { usuario = p }, c, motoIds, frete)

/** O formulário do Editar com o que foi gravado na efetivação (motos a 10.000, capacete a 250, sem frete). */
const formulario = (c: ContaDoPedido, motoIds: string[], total: number) => ({
  dataVenda: '2026-11-18', clienteNome: 'Cliente sintético', clienteCpf: CPF_SINTETICO,
  pagamentos: [{ tipo: 'dinheiro', valor: 1000 }, { tipo: 'pix', valor: total - 1000 }],
  motos: motoIds.map(motoId => ({ motoId, valor: 10000 })),
  acessorios: [{ pecaId: c.capacete, valor: 250 }],
})
type Formulario = Parameters<Actions['editarPedidoEfetivadoAction']>[1]

const vendasDoPedido = (pedidoId: string) => execRows(sql`select moto_id, valor, cliente_nome, cliente_cidade, forma_pagamento, pagamentos
  from vendas where pedido_venda_id = ${pedidoId} order by moto_id`)
const caixaDo = (pedidoId: string) => execRows(sql`select l.valor from lancamentos_caixa l join vendas v on v.id = l.venda_id
  where v.pedido_venda_id = ${pedidoId} and l.tipo = 'entrada'`)
const vendaPecaDo = (pedidoId: string) => execRows(sql`select vp.valor_total, vp.cliente_nome, i.valor_unitario, i.quantidade
  from vendas_pecas vp join vendas_pecas_itens i on i.venda_peca_id = vp.id where vp.pedido_venda_id = ${pedidoId}`)

/** NF de produção autorizada há 1 hora na venda dada. */
const nfAutorizada = (c: ContaDoPedido, vendaId: string) =>
  execRows(sql`insert into notas_fiscais_saida (venda_id, venda_numero, grupo_id, id_externo, ambiente, status, numero, data_autorizacao, payload)
    select ${vendaId}, numero, ${c.base.grupoId}, ${randomUUID()}, 'Producao', 'Autorizada', '27', now() - interval '1 hour', '{}'::jsonb from vendas where id = ${vendaId}`)

test('E1: o sócio edita o pedido de 2 motos sem NF: cliente nas 2 vendas, valores por moto e acessório, pagamento e caixa só na do pagamento', async () => {
  const c = await semearConta()
  const [m1, m2] = (await c.motos(2)).sort()
  const p = await pedidoEfetivado(c, [m1, m2])
  usuario = c.socio
  const editado: Formulario = {
    ...formulario(c, [m1, m2], 0), clienteNome: 'Ana Moreira', clienteCidade: 'Timon',
    motos: [{ motoId: m1, valor: 9000 }, { motoId: m2, valor: 11000 }], acessorios: [{ pecaId: c.capacete, valor: 200 }],
    pagamentos: [{ tipo: 'dinheiro', valor: 400 }, { tipo: 'pix', valor: 20000 }],
  }

  assert.deepEqual(await actions.editarPedidoEfetivadoAction(p.vendaDa(m2), editado), OK)

  const vendas = await vendasDoPedido(p.pedidoId)
  assert.deepEqual(vendas.map(v => [v.moto_id, v.valor, v.cliente_nome, v.cliente_cidade]),
    [[m1, '9000.00', 'Ana Moreira', 'Timon'], [m2, '11000.00', 'Ana Moreira', 'Timon']])
  assert.deepEqual(vendas.filter(v => v.forma_pagamento !== 'pedido').map(v => v.pagamentos), [editado.pagamentos])
  assert.deepEqual(await caixaDo(p.pedidoId), [{ valor: '400.00' }])
  assert.deepEqual(await execRows(sql`select moto_id, valor_unitario from pedidos_venda_itens where pedido_venda_id = ${p.pedidoId} order by tipo::text, moto_id`),
    [{ moto_id: null, valor_unitario: '200.00' }, { moto_id: m1, valor_unitario: '9000.00' }, { moto_id: m2, valor_unitario: '11000.00' }])
  assert.deepEqual(await vendaPecaDo(p.pedidoId), [{ valor_total: '400.00', cliente_nome: 'Ana Moreira', valor_unitario: '200.00', quantidade: '2.00' }])
})

test('E2: aux_adm não muda o valor de uma moto nem do acessório; nada muda', async () => {
  const c = await semearConta()
  const motoIds = await c.motos(2)
  const p = await pedidoEfetivado(c, motoIds)
  usuario = c.aux
  const base = formulario(c, motoIds, 20500)
  for (const mudanca of [{ motos: [{ motoId: motoIds[0], valor: 9500 }, { motoId: motoIds[1], valor: 10000 }] }, { acessorios: [{ pecaId: c.capacete, valor: 0 }] }]) {
    assert.deepEqual(await actions.editarPedidoEfetivadoAction(p.vendaDa(motoIds[0]), { ...base, ...mudanca }),
      recusa('O valor da venda só pode ser alterado pelos administradores.'))
  }
  assert.deepEqual((await vendasDoPedido(p.pedidoId)).map(v => v.valor), ['10000.00', '10000.00'])
})

test('E3: aux_adm corrige só o pagamento (soma = total do pedido) e o caixa é refeito', async () => {
  const c = await semearConta()
  const motoIds = await c.motos(2)
  const p = await pedidoEfetivado(c, motoIds)
  usuario = c.aux
  const pagamentos = [{ tipo: 'pix', valor: 20500 }]
  assert.deepEqual(await actions.editarPedidoEfetivadoAction(p.vendaDa(motoIds[1]), { ...formulario(c, motoIds, 20500), pagamentos }), OK)
  assert.deepEqual((await vendasDoPedido(p.pedidoId)).filter(v => v.forma_pagamento !== 'pedido').map(v => [v.forma_pagamento, v.pagamentos]), [['pix', pagamentos]])
  assert.deepEqual(await caixaDo(p.pedidoId), [])
})

test('E4: pagamento que não fecha com motos + frete + acessórios é recusado; nada muda', async () => {
  const c = await semearConta()
  const motoIds = await c.motos(2)
  const p = await pedidoEfetivado(c, motoIds, 300)
  usuario = c.socio
  for (const pix of [19800, 20500]) {
    assert.deepEqual(await actions.editarPedidoEfetivadoAction(p.vendaDa(motoIds[0]), { ...formulario(c, motoIds, 20800), pagamentos: [{ tipo: 'pix', valor: pix }] }),
      recusa(SOMA_PAGAMENTOS_DIFERE), String(pix))
  }
  assert.deepEqual(await caixaDo(p.pedidoId), [{ valor: '1000.00' }])
  assert.equal(OK.ok, (await actions.editarPedidoEfetivadoAction(p.vendaDa(motoIds[0]), { ...formulario(c, motoIds, 20800), pagamentos: [{ tipo: 'pix', valor: 20800 }] })).ok)
})

test('E5: NF autorizada numa venda do pedido: mudar o cliente ou um valor é recusado com a frase da nota; nada muda', async () => {
  const c = await semearConta()
  const motoIds = await c.motos(2)
  const p = await pedidoEfetivado(c, motoIds)
  await nfAutorizada(c, p.vendaDa(motoIds[0]))
  usuario = c.socio
  const base = formulario(c, motoIds, 20500)
  const frase = 'A nota fiscal nº 27 está valendo. Itens, valores e cliente estão nela e não mudam. Para mudar, cancele a nota antes.'
  for (const mudanca of [{ clienteNome: 'Outro' }, { motos: [{ motoId: motoIds[0], valor: 10000 }, { motoId: motoIds[1], valor: 9000 }], pagamentos: [{ tipo: 'pix', valor: 19500 }] }]) {
    assert.deepEqual(await actions.editarPedidoEfetivadoAction(p.vendaDa(motoIds[1]), { ...base, ...mudanca }), recusa(frase))
  }
  assert.deepEqual((await vendasDoPedido(p.pedidoId)).map(v => [v.valor, v.cliente_nome]), [['10000.00', 'Cliente sintético'], ['10000.00', 'Cliente sintético']])
})

test('E6: NF autorizada ou nº de NF com o aux_adm: o pagamento se corrige', async () => {
  const c = await semearConta()
  const motoIds = await c.motos(2)
  const p = await pedidoEfetivado(c, motoIds)
  await nfAutorizada(c, p.vendaDa(motoIds[0]))
  await execRows(sql`update vendas set nota_fiscal_saida = '4321' where id = ${p.vendaDa(motoIds[1])}`)
  usuario = c.aux
  const pagamentos = [{ tipo: 'pix', valor: 20500 }]
  assert.deepEqual(await actions.editarPedidoEfetivadoAction(p.vendaDa(motoIds[1]), { ...formulario(c, motoIds, 20500), pagamentos }), OK)
  assert.deepEqual((await vendasDoPedido(p.pedidoId)).filter(v => v.forma_pagamento !== 'pedido').map(v => v.pagamentos), [pagamentos])
})

test('E7: Conta B não edita o pedido da A (mesma frase do inexistente); maquininha de outra Conta é recusada; nada muda na A', async () => {
  const a = await semearConta()
  const b = await semearConta()
  const motoIds = await a.motos(2)
  const p = await pedidoEfetivado(a, motoIds)
  const form = { ...formulario(a, motoIds, 20500), clienteNome: 'Outro' }
  usuario = b.socio
  const daOutraConta = await actions.editarPedidoEfetivadoAction(p.vendaDa(motoIds[0]), form)
  assert.deepEqual(daOutraConta, recusa('Venda não encontrada'))
  assert.deepEqual(await actions.editarPedidoEfetivadoAction(randomUUID(), form), daOutraConta)
  const [maquininhaB] = await execRows(sql`insert into maquininhas (grupo_id, nome, operadora) values (${b.base.grupoId}, 'Maq B', ${'opB' + randomUUID()}) returning operadora`)
  usuario = a.socio
  const comMaquininhaB = { ...form, pagamentos: [{ tipo: 'credito', valor: 20500, operadora: maquininhaB.operadora as string, parcelas: 1 }] }
  assert.equal((await actions.editarPedidoEfetivadoAction(p.vendaDa(motoIds[0]), comMaquininhaB)).ok, false)
  assert.deepEqual((await vendasDoPedido(p.pedidoId)).map(v => v.cliente_nome), ['Cliente sintético', 'Cliente sintético'])
})

test('E8: pedido forjado: campos a mais não gravam; moto de outro pedido ou peça a menos é recusada', async () => {
  const c = await semearConta()
  const [m1, m2, fora] = await c.motos(3)
  const p = await pedidoEfetivado(c, [m1, m2])
  usuario = c.socio
  const forjado = { ...formulario(c, [m1, m2], 20500), lojaId: randomUUID(), numero: 1, pedidoVendaId: randomUUID(), clienteId: randomUUID(), formaPagamento: 'x' }
  assert.deepEqual(await actions.editarPedidoEfetivadoAction(p.vendaDa(m1), forjado as Formulario), OK)
  const [v] = await execRows(sql`select loja_id, cliente_id, pedido_venda_id from vendas where id = ${p.vendaDa(m1)}`)
  assert.deepEqual(v, { loja_id: c.base.lojaId, cliente_id: null, pedido_venda_id: p.pedidoId })

  const itensMudaram = recusa('Os itens do pedido mudaram. Recarregue a página.')
  const base = formulario(c, [m1, m2], 20500)
  assert.deepEqual(await actions.editarPedidoEfetivadoAction(p.vendaDa(m1), { ...base, motos: [{ motoId: m1, valor: 10000 }, { motoId: fora, valor: 10000 }] }), itensMudaram)
  assert.deepEqual(await actions.editarPedidoEfetivadoAction(p.vendaDa(m1), { ...base, acessorios: [] }), itensMudaram)
})

test('E9: a leitura do Editar traz o pedido para a tela (cliente, pagamento, motos e acessório com valor, frete, NF que trava); Conta B não lê', async () => {
  const a = await semearConta()
  const b = await semearConta()
  const [m1, m2] = (await a.motos(2)).sort()
  const p = await pedidoEfetivado(a, [m1, m2], 300)
  usuario = a.aux

  const lido = await actions.pedidoEfetivadoAction(p.vendaDa(m1))
  assert.equal(lido.ok, true)
  const d = lido.ok ? lido.dados : null
  assert.deepEqual(d && {
    motos: d.motos.map(m => [m.id, m.valor]).sort(), pecas: d.pecas.map(x => [x.tipo, x.pecaId, x.quantidade, x.valor]),
    cliente: [d.comprador.clienteNome, d.comprador.clienteCpf], pagamentos: d.pagamentos, frete: d.frete, nota: d.notaQueTrava,
  }, {
    motos: [[m1, '10000.00'], [m2, '10000.00']], pecas: [['acessorio', a.capacete, 2, '250.00']],
    cliente: ['Cliente sintético', CPF_SINTETICO], pagamentos: [{ tipo: 'dinheiro', valor: 1000 }, { tipo: 'pix', valor: 19800 }], frete: 300, nota: null,
  })

  await nfAutorizada(a, p.vendaDa(m2))
  const comNota = await actions.pedidoEfetivadoAction(p.vendaDa(m1))
  assert.deepEqual(comNota.ok && comNota.dados.notaQueTrava, { numero: '27' })

  usuario = b.aux
  assert.deepEqual(await actions.pedidoEfetivadoAction(p.vendaDa(m1)), recusa('Venda não encontrada'))
  assert.deepEqual(await actions.pedidoEfetivadoAction(randomUUID()), recusa('Venda não encontrada'))
})
