// Teste de banco do pedido com várias motos (#20, PR A): criar, trocar e cancelar o pedido pendente com N motos,
// pelas actions e com a persona real. As actions gravam fora de transação de teste: cada cenário cria a própria
// Conta e só confere o que criou.
import { after, before, mock, test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { semearContaComMotos } from '@/test/semear-motos'
import { semearUsuario } from '@/test/semear-conta'

const url = process.env.TEST_DATABASE_URL
if (!url || !['localhost', '127.0.0.1'].includes(new URL(url).hostname)) throw new Error('Use somente Postgres descartável local')
process.env.DATABASE_URL = url

type Persona = { id: string; papel: string; lojaId: string | null; gruposAcesso: string[]; contaId: string }
let usuario: Persona

const authMock = mock.module('@/lib/auth', { namedExports: { getUsuarioLogado: async () => usuario } })
const cacheMock = mock.module('next/cache', { namedExports: { revalidatePath: () => {} } })

type Db = typeof import('@/lib/db')
let db: Db['db']
let execRows: Db['execRows']
let actions: typeof import('@/app/(dashboard)/vendas/actions')
let arquivarMotos: typeof import('@/lib/arquivar-motos')['arquivarMotos']
let removerMotos: typeof import('@/lib/remover-motos')['removerMotos']

before(async () => {
  ;({ db, execRows } = await import('@/lib/db'))
  actions = await import('@/app/(dashboard)/vendas/actions')
  ;({ arquivarMotos } = await import('@/lib/arquivar-motos'))
  ;({ removerMotos } = await import('@/lib/remover-motos'))
})
after(async () => {
  authMock.restore()
  cacheMock.restore()
  await (globalThis as { __pgPool?: { end(): Promise<void> } }).__pgPool?.end()
})

const RETIRA = { modo: 'retira', modalidade: 'TransporteProprioPorContaDoDestinatario' } as const
const OK = { ok: true, dados: undefined }
const recusa = (erro: string) => ({ ok: false, erro })

async function semearConta() {
  const c = await semearContaComMotos(db, 'PVM20', randomUUID(), randomUUID(), randomUUID())
  const vendedorId = await semearUsuario(db, c.base, { papel: 'vendedor', rotulo: 'vend' })
  const outroVendedorId = await semearUsuario(db, c.base, { papel: 'vendedor', rotulo: 'vend2' })
  const comum = { lojaId: c.base.lojaId, gruposAcesso: [], contaId: c.base.contaId }
  const [origem] = await execRows(sql`insert into origens_venda (grupo_id, nome) values (${c.base.grupoId}, 'Passou na porta') returning id`)
  return {
    ...c,
    origemId: origem.id as string,
    vendedor: { id: vendedorId, papel: 'vendedor', ...comum },
    outroVendedor: { id: outroVendedorId, papel: 'vendedor', ...comum },
    motos: async (n: number, disp = 'disponivel') => Promise.all(Array.from({ length: n }, () => c.novaMoto(randomUUID().slice(0, 8), c.base.lojaId, disp))),
  }
}
type Conta = Awaited<ReturnType<typeof semearConta>>

/** Pedido criado pelo vendedor com as motos dadas; devolve o id. */
async function criarPedido(c: Conta, motoIds: string[]) {
  usuario = c.vendedor
  assert.deepEqual(await actions.criarPedidoVendaAction(motoIds.map(motoId => ({ motoId })), '', RETIRA), OK)
  const [p] = await execRows(sql`select p.id from pedidos_venda p join pedidos_venda_itens i on i.pedido_venda_id = p.id
    where i.moto_id = ${motoIds[0]} and p.status = 'pendente'`)
  return p.id as string
}

const pedidosDaMoto = (motoId: string) => execRows(sql`select p.id from pedidos_venda p
  where p.moto_id = ${motoId} or exists (select 1 from pedidos_venda_itens i where i.pedido_venda_id = p.id and i.moto_id = ${motoId})`)

const disponibilidades = async (ids: string[]) =>
  (await execRows(sql`select id, disponibilidade from motos where id in ${ids}`))
    .reduce<Record<string, unknown>>((acc, m) => ({ ...acc, [m.id as string]: m.disponibilidade }), {})

const motosDoPedidoNoBanco = (pedidoId: string) => execRows(sql`select i.moto_id, i.valor_unitario from pedidos_venda_itens i
  where i.pedido_venda_id = ${pedidoId} and i.tipo = 'moto' order by i.criado_em, i.id`)

const motoDoPedido = async (pedidoId: string) => (await execRows(sql`select moto_id from pedidos_venda where id = ${pedidoId}`))[0].moto_id

test('D1: o vendedor cria o pedido com 2 motos da loja; as duas ficam reservadas e o valor só da que veio', async () => {
  const c = await semearConta()
  const [m1, m2] = await c.motos(2)
  usuario = c.vendedor
  assert.deepEqual(await actions.criarPedidoVendaAction([{ motoId: m1 }, { motoId: m2, valor: 13000 }], 'duas motos', RETIRA), OK)

  const [pedido] = await pedidosDaMoto(m2)
  assert.equal(await motoDoPedido(pedido.id as string), m1)
  assert.deepEqual(await motosDoPedidoNoBanco(pedido.id as string), [{ moto_id: m1, valor_unitario: null }, { moto_id: m2, valor_unitario: '13000.00' }])
  assert.deepEqual(await disponibilidades([m1, m2]), { [m1]: 'reservada', [m2]: 'reservada' })
  const historico = await execRows(sql`select moto_id from historico_estoque where referencia_id = ${pedido.id} order by moto_id`)
  assert.deepEqual(historico.map(h => h.moto_id), [m1, m2].sort())
})

test('D1b: valor de moto zero, negativo ou que não é número é recusado e nada é gravado', async () => {
  const c = await semearConta()
  const [m1, m2] = await c.motos(2)
  usuario = c.vendedor
  for (const valor of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.deepEqual(await actions.criarPedidoVendaAction([{ motoId: m1 }, { motoId: m2, valor }], '', RETIRA), recusa('Valor inválido'))
  }
  assert.deepEqual(await pedidosDaMoto(m1), [])
  assert.deepEqual(await disponibilidades([m1, m2]), { [m1]: 'disponivel', [m2]: 'disponivel' })
})

test('D2: moto de outra loja da mesma Conta não entra; nada é gravado e a 1ª segue disponível', async () => {
  const c = await semearConta()
  const [m1] = await c.motos(1)
  const deOutraLoja = await c.novaMoto(randomUUID().slice(0, 8), c.outro.lojaId)
  usuario = c.socio
  assert.deepEqual(await actions.criarPedidoVendaAction([{ motoId: m1 }, { motoId: deOutraLoja }], '', RETIRA),
    recusa('Só motos da mesma loja no pedido. Transfira a moto antes.'))
  assert.deepEqual(await pedidosDaMoto(m1), [])
  assert.deepEqual(await disponibilidades([m1, deOutraLoja]), { [m1]: 'disponivel', [deOutraLoja]: 'disponivel' })
})

test('D3: moto de outra Conta, id inexistente e id que não é uuid recebem a mesma frase; nada muda nas duas Contas', async () => {
  const a = await semearConta()
  const b = await semearConta()
  const [daA] = await a.motos(1)
  const [daB] = await b.motos(1)
  usuario = b.vendedor
  for (const intrusa of [daA, randomUUID(), 'nao-e-uuid']) {
    assert.deepEqual(await actions.criarPedidoVendaAction([{ motoId: daB }, { motoId: intrusa }], '', RETIRA), recusa('Moto não encontrada'))
  }
  assert.deepEqual(await pedidosDaMoto(daB), [])
  assert.deepEqual(await pedidosDaMoto(daA), [])
  assert.deepEqual(await disponibilidades([daA, daB]), { [daA]: 'disponivel', [daB]: 'disponivel' })
})

test('D4: 2ª moto reservada, em transporte ou com transferência pendente não entra; nada é gravado', async () => {
  const c = await semearConta()
  const [m1, emTransporte, comTransferencia] = await c.motos(3)
  const [reservada] = await c.motos(1, 'reservada')
  await execRows(sql`update motos set status = 'em_transporte' where id = ${emTransporte}`)
  await execRows(sql`insert into transferencias (moto_id, loja_origem_id, loja_destino_id, solicitado_por, status)
    values (${comTransferencia}, ${c.base.lojaId}, ${c.outro.lojaId}, ${c.auxId}, 'pendente')`)
  usuario = c.aux
  const casos: [string, string][] = [
    [reservada, 'Moto não está disponível (reservada)'],
    [emTransporte, 'Moto ainda em transporte. Não pode ser vendida.'],
    [comTransferencia, 'Moto tem transferência pendente'],
  ]
  for (const [moto, frase] of casos) {
    assert.deepEqual(await actions.criarPedidoVendaAction([{ motoId: m1 }, { motoId: moto }], '', RETIRA), recusa(frase))
  }
  assert.deepEqual(await pedidosDaMoto(m1), [])
  assert.equal((await disponibilidades([m1]))[m1], 'disponivel')
})

test('D5: a mesma moto mandada duas vezes entra uma vez só', async () => {
  const c = await semearConta()
  const [m1, m2] = await c.motos(2)
  const pedidoId = await criarPedido(c, [m1, m2, m2])
  assert.deepEqual((await motosDoPedidoNoBanco(pedidoId)).map(i => i.moto_id), [m1, m2])
})

test('D6: o aux_adm troca as motos: a que sai volta a disponível, a nova fica reservada e o pedido passa a ser da que ficou', async () => {
  const c = await semearConta()
  const [m1, m2, m3] = await c.motos(3)
  const pedidoId = await criarPedido(c, [m1, m2])
  usuario = c.aux
  assert.deepEqual(await actions.trocarMotosDoPedidoAction(pedidoId, [{ motoId: m2, valor: 12000 }, { motoId: m3 }]), OK)

  assert.equal(await motoDoPedido(pedidoId), m2)
  assert.deepEqual(await motosDoPedidoNoBanco(pedidoId), [{ moto_id: m2, valor_unitario: '12000.00' }, { moto_id: m3, valor_unitario: null }])
  assert.deepEqual(await disponibilidades([m1, m2, m3]), { [m1]: 'disponivel', [m2]: 'reservada', [m3]: 'reservada' })
  const historico = await execRows(sql`select moto_id, observacao from historico_estoque
    where referencia_id = ${pedidoId} and observacao not like 'Pedido de venda criado%' order by observacao`)
  assert.deepEqual(historico, [
    { moto_id: m3, observacao: 'Moto entrou no pedido de venda — moto reservada' },
    { moto_id: m1, observacao: 'Moto saiu do pedido de venda' },
  ])
})

test('D7: trocar recusa a lista vazia, o pedido em aprovação e o pedido que não está pendente; nada muda', async () => {
  const c = await semearConta()
  const [m1, m2, m3] = await c.motos(3)
  const pedidoId = await criarPedido(c, [m1, m2])
  usuario = c.aux
  assert.deepEqual(await actions.trocarMotosDoPedidoAction(pedidoId, []), recusa('O pedido precisa de ao menos uma moto. Para desistir, cancele o pedido.'))

  await execRows(sql`insert into aprovacoes_venda (origem, moto_id, loja_id, vendedor_id, valor, dados_venda, motivo, tipo, status)
    values ('pedido', ${m1}, ${c.base.lojaId}, ${c.vendedor.id}, 1, ${JSON.stringify({ pedidoId })}::jsonb, 'teste', 'valor_minimo', 'pendente')`)
  assert.deepEqual(await actions.trocarMotosDoPedidoAction(pedidoId, [{ motoId: m3 }]), recusa('Este pedido está aguardando aprovação. Aprove ou recuse antes de trocar as motos.'))
  await execRows(sql`update aprovacoes_venda set status = 'recusada' where dados_venda->>'pedidoId' = ${pedidoId}`)

  assert.deepEqual(await actions.cancelarPedidoAction(pedidoId), OK)
  assert.deepEqual(await actions.trocarMotosDoPedidoAction(pedidoId, [{ motoId: m3 }]), recusa('Este pedido não está mais pendente. Recarregue a página.'))
  assert.equal((await disponibilidades([m3]))[m3], 'disponivel')
})

test('D8: Conta B não troca motos do pedido da A nem põe moto da A no seu; mesma frase do inexistente e nada muda na A', async () => {
  const a = await semearConta()
  const b = await semearConta()
  const [a1, a2] = await a.motos(2)
  const [b1, b2] = await b.motos(2)
  const pedidoA = await criarPedido(a, [a1])
  const pedidoB = await criarPedido(b, [b1])
  usuario = b.aux
  assert.deepEqual(await actions.trocarMotosDoPedidoAction(pedidoA, [{ motoId: b2 }]), recusa('Pedido não encontrado'))
  assert.deepEqual(await actions.trocarMotosDoPedidoAction(randomUUID(), [{ motoId: b2 }]), recusa('Pedido não encontrado'))
  assert.deepEqual(await actions.trocarMotosDoPedidoAction(pedidoB, [{ motoId: b1 }, { motoId: a2 }]), recusa('Moto não encontrada'))

  assert.deepEqual((await motosDoPedidoNoBanco(pedidoA)).map(i => i.moto_id), [a1])
  assert.deepEqual((await motosDoPedidoNoBanco(pedidoB)).map(i => i.moto_id), [b1])
  assert.deepEqual(await disponibilidades([a1, a2, b2]), { [a1]: 'reservada', [a2]: 'disponivel', [b2]: 'disponivel' })
})

test('D9: troca quem cancela (D-G): o vendedor só no pedido que criou', async () => {
  const c = await semearConta()
  const [m1, m2] = await c.motos(2)
  const pedidoId = await criarPedido(c, [m1])
  usuario = c.outroVendedor
  assert.deepEqual(await actions.trocarMotosDoPedidoAction(pedidoId, [{ motoId: m1 }, { motoId: m2 }]), recusa('Sem permissão para alterar este pedido'))
  usuario = c.vendedor
  assert.deepEqual(await actions.trocarMotosDoPedidoAction(pedidoId, [{ motoId: m1 }, { motoId: m2 }]), OK)
  assert.deepEqual((await motosDoPedidoNoBanco(pedidoId)).map(i => i.moto_id), [m1, m2])
})

test('D10: cancelar o pedido solta todas as motos', async () => {
  const c = await semearConta()
  const [m1, m2] = await c.motos(2)
  const pedidoId = await criarPedido(c, [m1, m2])
  usuario = c.aux
  assert.deepEqual(await actions.cancelarPedidoAction(pedidoId, 'desistiu'), OK)
  assert.deepEqual(await disponibilidades([m1, m2]), { [m1]: 'disponivel', [m2]: 'disponivel' })
  const historico = await execRows(sql`select moto_id from historico_estoque where referencia_id = ${pedidoId} and observacao like 'Pedido de venda cancelado%'`)
  assert.deepEqual(historico.map(h => h.moto_id).sort(), [m1, m2].sort())
})

test('D10b: até a efetivação com várias motos (PR B), o pedido de 2 motos não efetiva e nada é vendido', async () => {
  const c = await semearConta()
  const [m1, m2] = await c.motos(2)
  const pedidoId = await criarPedido(c, [m1, m2])
  usuario = c.aux
  assert.deepEqual(await actions.efetivarVendaAction(pedidoId, 'Cliente sintético', '529.982.247-25', '10000', [{ tipo: 'pix', valor: 10000 }], undefined, c.origemId),
    recusa('Pedido com várias motos ainda não pode ser efetivado.'))
  assert.deepEqual(await execRows(sql`select id from vendas where pedido_venda_id = ${pedidoId}`), [])
  assert.deepEqual(await disponibilidades([m1, m2]), { [m1]: 'reservada', [m2]: 'reservada' })
})

test('D20: a 2ª moto de um pedido pendente não se arquiva nem se remove; a de pedido cancelado se remove', async () => {
  const c = await semearConta()
  const [m1, m2] = await c.motos(2)
  const pedidoId = await criarPedido(c, [m1, m2])
  await assert.rejects(arquivarMotos(c.socio, [m2], 'teste'), /pedido de venda em aberto/)
  await assert.rejects(removerMotos(c.socio, [m2], 'teste', 'CONFIRMAR'), /pedido de venda em aberto/)

  usuario = c.aux
  assert.deepEqual(await actions.cancelarPedidoAction(pedidoId), OK)
  assert.deepEqual(await removerMotos(c.socio, [m2], 'importada errada', 'CONFIRMAR'), { removidas: 1 })
  assert.deepEqual((await motosDoPedidoNoBanco(pedidoId)).map(i => i.moto_id), [m1])
})
