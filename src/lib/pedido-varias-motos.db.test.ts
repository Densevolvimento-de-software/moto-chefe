// Teste de banco do pedido com várias motos (#20): criar, trocar e cancelar o pedido pendente com N motos (PR A) e
// efetivar uma venda por moto (PR B1), pelas actions e com a persona real. As actions gravam fora de transação de teste: cada cenário cria a própria
// Conta e só confere o que criou.
import { after, before, mock, test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { semearContaComMotos } from '@/test/semear-motos'
import { semearUsuario } from '@/test/semear-conta'
import { ate, esperandoPor } from '@/test/espera-de-trava'
import { entregarSintetico } from '@/test/entrega-sintetica'
import { SOMA_PAGAMENTOS_DIFERE } from '@/lib/pagamentos-entrada'
import { PEDIDO_EM_APROVACAO_PARA_ALTERAR } from '@/lib/notagateway/entrega'
import pg from 'pg'

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
type Actions = typeof import('@/app/(dashboard)/vendas/actions')
let actions: Actions
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
  const aprovadorId = await semearUsuario(db, c.base, { papel: 'admin_socio', rotulo: 'aprov', comConta: true })
  const comum = { lojaId: c.base.lojaId, gruposAcesso: [], contaId: c.base.contaId }
  const [origem] = await execRows(sql`insert into origens_venda (grupo_id, nome) values (${c.base.grupoId}, 'Passou na porta') returning id`)
  return {
    ...c,
    origemId: origem.id as string,
    vendedor: { id: vendedorId, papel: 'vendedor', ...comum },
    outroVendedor: { id: outroVendedorId, papel: 'vendedor', ...comum },
    aprovador: { id: aprovadorId, papel: 'admin_socio', ...comum },
    motos: async (n: number, disp = 'disponivel') => Promise.all(Array.from({ length: n }, () => c.novaMoto(randomUUID().slice(0, 8), c.base.lojaId, disp))),
  }
}
type Conta = Awaited<ReturnType<typeof semearConta>>

/** Pedido criado pelo vendedor com as motos dadas; devolve o id. */
async function criarPedido(c: Conta, motoIds: string[], entrega: Parameters<Actions['criarPedidoVendaAction']>[2] = RETIRA) {
  usuario = c.vendedor
  assert.deepEqual(await actions.criarPedidoVendaAction(motoIds.map(motoId => ({ motoId })), '', entrega), OK)
  const [p] = await execRows(sql`select p.id from pedidos_venda p join pedidos_venda_itens i on i.pedido_venda_id = p.id
    where i.moto_id = ${motoIds[0]} and p.status = 'pendente'`)
  return p.id as string
}

const pedidosDaMoto = (motoId: string) => execRows(sql`select p.id from pedidos_venda p
  where p.moto_id = ${motoId} or exists (select 1 from pedidos_venda_itens i where i.pedido_venda_id = p.id and i.moto_id = ${motoId})`)

const disponibilidades = async (ids: string[]) =>
  (await execRows(sql`select id, disponibilidade from motos where id in ${ids}`))
    .reduce<Record<string, unknown>>((acc, m) => ({ ...acc, [m.id as string]: m.disponibilidade }), {})

// A comparação é pela moto; a ordem de inclusão tem cenário próprio (D24).
const motosDoPedidoNoBanco = (pedidoId: string) => execRows(sql`select i.moto_id, i.valor_unitario from pedidos_venda_itens i
  where i.pedido_venda_id = ${pedidoId} and i.tipo = 'moto' order by i.moto_id`)
const porMoto = <T extends { moto_id: string }>(itens: T[]) => [...itens].sort((a, b) => a.moto_id.localeCompare(b.moto_id))
const idsDasMotos = async (pedidoId: string) => (await motosDoPedidoNoBanco(pedidoId)).map(i => i.moto_id)

const CPF = '529.982.247-25'
const efetivarMotos = (c: Conta, pedidoId: string, valores: Parameters<Actions['efetivarVendaAction']>[3], pagamentos: { tipo: string; valor: number }[], motivo?: string) =>
  actions.efetivarVendaAction(pedidoId, 'Cliente sintético', CPF, valores, pagamentos, undefined, c.origemId, undefined, motivo)
const vendasDoPedido = (pedidoId: string) => execRows(sql`select v.moto_id, v.valor, v.forma_pagamento, v.pagamentos, v.numero,
  v.numero = p.numero as numero_do_pedido from vendas v join pedidos_venda p on p.id = v.pedido_venda_id where v.pedido_venda_id = ${pedidoId} order by v.moto_id`)

async function comPrecoMinimo(c: Conta, motoId: string, minimo: number) {
  const [{ modelo }] = await execRows(sql`select mo.modelo from motos m join modelos mo on mo.id = m.modelo_id where m.id = ${motoId}`)
  await execRows(sql`insert into precificacao (grupo_id, nome, valor_minimo) values (${c.base.grupoId}, ${modelo}, ${String(minimo)})`)
  await execRows(sql`insert into configuracao_taxas (grupo_id) values (${c.base.grupoId})`)
}

const motoDoPedido = async (pedidoId: string) => (await execRows(sql`select moto_id from pedidos_venda where id = ${pedidoId}`))[0].moto_id

test('D1: o vendedor cria o pedido com 2 motos da loja; as duas ficam reservadas e o valor só da que veio', async () => {
  const c = await semearConta()
  const [m1, m2] = await c.motos(2)
  usuario = c.vendedor
  assert.deepEqual(await actions.criarPedidoVendaAction([{ motoId: m1 }, { motoId: m2, valor: 13000 }], 'duas motos', RETIRA), OK)

  const [pedido] = await pedidosDaMoto(m2)
  assert.equal(await motoDoPedido(pedido.id as string), m1)
  assert.deepEqual(await motosDoPedidoNoBanco(pedido.id as string), porMoto([{ moto_id: m1, valor_unitario: null }, { moto_id: m2, valor_unitario: '13000.00' }]))
  assert.deepEqual(await disponibilidades([m1, m2]), { [m1]: 'reservada', [m2]: 'reservada' })
  const historico = await execRows(sql`select moto_id from historico_estoque where referencia_id = ${pedido.id} order by moto_id`)
  assert.deepEqual(historico.map(h => h.moto_id), [m1, m2].sort())
})

test('D1b: valor de moto zero, negativo, abaixo de 1 centavo, maior que a coluna ou que não é número é recusado e nada é gravado', async () => {
  const c = await semearConta()
  const [m1, m2] = await c.motos(2)
  usuario = c.vendedor
  for (const valor of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, 0.004, 1e15]) {
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
  assert.deepEqual(await idsDasMotos(pedidoId), [m1, m2].sort())
})

test('D6: o aux_adm troca as motos: a que sai volta a disponível, a nova fica reservada e o pedido passa a ser da que ficou', async () => {
  const c = await semearConta()
  const [m1, m2, m3] = await c.motos(3)
  const pedidoId = await criarPedido(c, [m1, m2])
  usuario = c.aux
  assert.deepEqual(await actions.trocarMotosDoPedidoAction(pedidoId, [{ motoId: m2, valor: 12000 }, { motoId: m3 }]), OK)

  assert.equal(await motoDoPedido(pedidoId), m2)
  assert.deepEqual(await motosDoPedidoNoBanco(pedidoId), porMoto([{ moto_id: m2, valor_unitario: '12000.00' }, { moto_id: m3, valor_unitario: null }]))
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

  assert.deepEqual(await idsDasMotos(pedidoA), [a1])
  assert.deepEqual(await idsDasMotos(pedidoB), [b1])
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
  assert.deepEqual(await idsDasMotos(pedidoId), [m1, m2].sort())
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

test('D20: a 2ª moto de um pedido pendente não se arquiva nem se remove; a de pedido cancelado se remove', async () => {
  const c = await semearConta()
  const [m1, m2] = await c.motos(2)
  const pedidoId = await criarPedido(c, [m1, m2])
  await assert.rejects(arquivarMotos(c.socio, [m2], 'teste'), /pedido de venda em aberto/)
  await assert.rejects(removerMotos(c.socio, [m2], 'teste', 'CONFIRMAR'), /pedido de venda em aberto/)

  usuario = c.aux
  assert.deepEqual(await actions.cancelarPedidoAction(pedidoId), OK)
  assert.deepEqual(await removerMotos(c.socio, [m2], 'importada errada', 'CONFIRMAR'), { removidas: 1 })
  assert.deepEqual(await idsDasMotos(pedidoId), [m1])
})

test('D3b: lista de motos com forma errada (vinda do navegador) recebe a frase de moto não encontrada; nada é gravado', async () => {
  const c = await semearConta()
  const [m1] = await c.motos(1)
  usuario = c.vendedor
  for (const forjada of [[{ motoId: m1 }, null], [{ motoId: m1, valor: '10' }], { motoId: m1 }]) {
    assert.deepEqual(await actions.criarPedidoVendaAction(forjada as never, '', RETIRA), recusa('Moto não encontrada'))
  }
  assert.deepEqual(await pedidosDaMoto(m1), [])
})

test('D6b: na troca, a moto que fica sem valor mandado guarda o valor que já tinha', async () => {
  const c = await semearConta()
  const [m1, m2, m3] = await c.motos(3)
  usuario = c.vendedor
  assert.deepEqual(await actions.criarPedidoVendaAction([{ motoId: m1, valor: 12000 }, { motoId: m2 }], '', RETIRA), OK)
  const [{ id: pedidoId }] = await pedidosDaMoto(m1)
  usuario = c.aux
  assert.deepEqual(await actions.trocarMotosDoPedidoAction(pedidoId as string, [{ motoId: m1 }, { motoId: m3 }]), OK)
  assert.deepEqual(await motosDoPedidoNoBanco(pedidoId as string), porMoto([{ moto_id: m1, valor_unitario: '12000.00' }, { moto_id: m3, valor_unitario: null }]))
})

test('D6c: na troca, a moto que entra passa pelas mesmas travas do criar (outra loja, reservada, transferência); nada muda', async () => {
  const c = await semearConta()
  const [m1, comTransferencia] = await c.motos(2)
  const [reservada] = await c.motos(1, 'reservada')
  const deOutraLoja = await c.novaMoto(randomUUID().slice(0, 8), c.outro.lojaId)
  await execRows(sql`insert into transferencias (moto_id, loja_origem_id, loja_destino_id, solicitado_por, status)
    values (${comTransferencia}, ${c.base.lojaId}, ${c.outro.lojaId}, ${c.auxId}, 'pendente')`)
  const pedidoId = await criarPedido(c, [m1])
  usuario = c.socio
  const casos: [string, string][] = [
    [deOutraLoja, 'Só motos da mesma loja no pedido. Transfira a moto antes.'],
    [reservada, 'Moto não está disponível (reservada)'],
    [comTransferencia, 'Moto tem transferência pendente'],
  ]
  for (const [moto, frase] of casos) {
    assert.deepEqual(await actions.trocarMotosDoPedidoAction(pedidoId, [{ motoId: m1 }, { motoId: moto }]), recusa(frase))
  }
  assert.deepEqual(await idsDasMotos(pedidoId), [m1])
  assert.deepEqual(await disponibilidades([deOutraLoja, comTransferencia]), { [deOutraLoja]: 'disponivel', [comTransferencia]: 'disponivel' })
})

test('D6d: pedido de antes dos itens (#774, sem item da moto): a troca grava o item da que fica e troca a do pedido quando ela sai', async () => {
  const c = await semearConta()
  const [m1, m2] = await c.motos(2)
  const [antigo] = await execRows(sql`insert into pedidos_venda (moto_id, loja_id, vendedor_id) values (${m1}, ${c.base.lojaId}, ${c.vendedor.id}) returning id`)
  await execRows(sql`update motos set disponibilidade = 'reservada' where id = ${m1}`)
  const pedidoId = antigo.id as string
  usuario = c.aux
  assert.deepEqual(await actions.trocarMotosDoPedidoAction(pedidoId, [{ motoId: m1, valor: 12000 }, { motoId: m2 }]), OK)
  assert.deepEqual(await motosDoPedidoNoBanco(pedidoId), porMoto([{ moto_id: m1, valor_unitario: '12000.00' }, { moto_id: m2, valor_unitario: null }]))
  assert.deepEqual(await actions.trocarMotosDoPedidoAction(pedidoId, [{ motoId: m2 }]), OK)
  assert.equal(await motoDoPedido(pedidoId), m2)
  assert.deepEqual(await disponibilidades([m1, m2]), { [m1]: 'disponivel', [m2]: 'reservada' })
})

test('D6e: a troca trava as motos que entram e as que saem em ordem de id (sem trava cruzada entre dois pedidos)', async () => {
  const c = await semearConta()
  const [menor, maior] = (await c.motos(2)).sort()
  const pedidoId = await criarPedido(c, [menor])
  // Outra sessão segura a moto de id maior; a troca [menor] -> [maior] tem de esperar já segurando a menor.
  const outra = new pg.Client({ connectionString: url })
  await outra.connect()
  try {
    await outra.query('begin')
    await outra.query('select id from motos where id = $1 for update', [maior])
    const pid = (await outra.query('select pg_backend_pid() p')).rows[0].p as number
    usuario = c.aux
    const troca = actions.trocarMotosDoPedidoAction(pedidoId, [{ motoId: maior }])
    await ate(async () => (await esperandoPor(db, pid)) > 0, 'a troca esperar a moto de id maior')
    await assert.rejects(outra.query('select id from motos where id = $1 for update nowait', [menor]), /could not obtain lock/)
    await outra.query('rollback')
    assert.deepEqual(await troca, OK)
  } finally {
    await outra.end()
  }
  assert.deepEqual(await disponibilidades([menor, maior]), { [menor]: 'disponivel', [maior]: 'reservada' })
})

/** Pedido de 2 motos (mesmo modelo, mínimo 12.000) mandado para aprovação pelo aux_adm; o pix não tem taxa. */
async function pedidoEmAprovacao(c: Conta, valores: [number, number]) {
  const [m1, m2] = await c.motos(2)
  await comPrecoMinimo(c, m1, 12000)
  const pedidoId = await criarPedido(c, [m1, m2])
  usuario = c.aux
  assert.deepEqual(await efetivarMotos(c, pedidoId, [{ motoId: m1, valor: valores[0] }, { motoId: m2, valor: valores[1] }],
    [{ tipo: 'pix', valor: valores[0] + valores[1] }], 'cliente fiel'), { ok: true, dados: { aprovacao: 'valor_minimo' } })
  return { pedidoId, m1, m2 }
}
const aprovacoesDoPedido = (pedidoId: string) => execRows(sql`select id, moto_id, valor, valor_minimo_snapshot as minimo, liquido_snapshot as liquido,
  status, disponibilidade_anterior::text as antes from aprovacoes_venda where dados_venda->>'pedidoId' = ${pedidoId} order by moto_id`)
const linha = (moto_id: string, valor: string, status = 'pendente') => ({ moto_id, valor, minimo: '12000.00', liquido: valor, status, antes: 'reservada' })

test('D14: 2 motos e só a 2ª abaixo do mínimo (líquido rateado): uma linha de aprovação, só dela; ela aguardando, a outra reservada; nenhuma venda', async () => {
  const c = await semearConta()
  const { pedidoId, m1, m2 } = await pedidoEmAprovacao(c, [12000, 11000])
  assert.deepEqual((await aprovacoesDoPedido(pedidoId)).map(({ id: _, ...a }) => a), [linha(m2, '11000.00')])
  assert.deepEqual(await disponibilidades([m1, m2]), { [m1]: 'reservada', [m2]: 'aguardando_aprovacao' })
  assert.deepEqual(await execRows(sql`select id from vendas where pedido_venda_id = ${pedidoId}`), [])

  // A Entrega não muda enquanto o pedido espera, mesmo com a moto do pedido só reservada.
  assert.deepEqual(await actions.alterarEntregaDoPedidoAction(pedidoId, entregarSintetico(300)), recusa(PEDIDO_EM_APROVACAO_PARA_ALTERAR))
  assert.deepEqual(await execRows(sql`select entrega->>'modo' as modo from pedidos_venda where id = ${pedidoId}`), [{ modo: 'retira' }])
})

test('D15: 2 motos abaixo (D-D): uma linha por moto; o sócio aprova uma e as duas vendem juntas, com o desconto de cada uma ligado à sua venda', async () => {
  const c = await semearConta()
  const { pedidoId, m1, m2 } = await pedidoEmAprovacao(c, [11500, 11000])
  const linhas = await aprovacoesDoPedido(pedidoId)
  assert.deepEqual(linhas.map(({ id: _, ...a }) => a), porMoto([linha(m1, '11500.00'), linha(m2, '11000.00')]))
  assert.deepEqual(await disponibilidades([m1, m2]), { [m1]: 'aguardando_aprovacao', [m2]: 'aguardando_aprovacao' })

  usuario = c.aprovador
  assert.deepEqual(await actions.aprovarVendaAction(linhas[1].id as string), OK)
  assert.deepEqual((await aprovacoesDoPedido(pedidoId)).map(a => a.status), ['aprovada', 'aprovada'])
  const vendas = await execRows(sql`select id, moto_id from vendas where pedido_venda_id = ${pedidoId} order by moto_id`)
  assert.deepEqual(vendas.map(v => v.moto_id), [m1, m2].sort())
  assert.deepEqual(await execRows(sql`select distinct status::text from motos where id in ${[m1, m2]}`), [{ status: 'vendida' }])
  assert.deepEqual(await actions.aprovarVendaAction(linhas[0].id as string), recusa('Esta solicitação não está mais pendente. Recarregue a página.'))

  const { descontosDasVendas } = await import('@/lib/queries/descontos')
  const descontos = await descontosDasVendas(vendas.map(v => v.id as string))
  assert.deepEqual(vendas.map(v => descontos.get(v.id as string)?.preco), vendas.map(v => (v.moto_id === m1 ? 500 : 1000)))
})

test('D16: o sócio recusa uma linha e o pedido inteiro volta: todas recusadas, cada moto reservada, pedido pendente e efetivável', async () => {
  const c = await semearConta()
  const { pedidoId, m1, m2 } = await pedidoEmAprovacao(c, [11500, 11000])
  const [primeira] = await aprovacoesDoPedido(pedidoId)
  usuario = c.aprovador
  assert.deepEqual(await actions.recusarVendaAction(primeira.id as string, 'abaixo demais'), OK)
  assert.deepEqual((await aprovacoesDoPedido(pedidoId)).map(a => a.status), ['recusada', 'recusada'])
  assert.deepEqual(await disponibilidades([m1, m2]), { [m1]: 'reservada', [m2]: 'reservada' })

  usuario = c.aux
  assert.deepEqual(await efetivarMotos(c, pedidoId, [{ motoId: m1, valor: 12000 }, { motoId: m2, valor: 12000 }], [{ tipo: 'pix', valor: 24000 }]), OK)
  assert.equal((await execRows(sql`select id from vendas where pedido_venda_id = ${pedidoId}`)).length, 2)
})

test('D17: o sócio da Conta B não aprova nem recusa a aprovação do pedido da A: mesma frase do inexistente; nada muda', async () => {
  const a = await semearConta()
  const b = await semearConta()
  const { pedidoId, m1, m2 } = await pedidoEmAprovacao(a, [11500, 11000])
  usuario = b.aprovador
  for (const { id } of await aprovacoesDoPedido(pedidoId)) {
    assert.deepEqual(await actions.aprovarVendaAction(id as string), recusa('Solicitação não encontrada'))
    assert.deepEqual(await actions.recusarVendaAction(id as string), recusa('Solicitação não encontrada'))
  }
  assert.deepEqual((await aprovacoesDoPedido(pedidoId)).map(x => x.status), ['pendente', 'pendente'])
  assert.deepEqual(await disponibilidades([m1, m2]), { [m1]: 'aguardando_aprovacao', [m2]: 'aguardando_aprovacao' })
})

test('D22: a frase de moto de outra Conta vem antes da de arquivada e da de outra loja: quem não alcança a moto não fica sabendo nada dela', async () => {
  const a = await semearConta()
  const b = await semearConta()
  const [daA] = await a.motos(1)
  const [b1, arquivada] = await b.motos(2)
  await execRows(sql`update motos set arquivada_em = now(), arquivada_por = ${b.socioId}, motivo_arquivo = 'golpe' where id = ${arquivada}`)
  const doOutroGrupo = await b.novaMoto(randomUUID().slice(0, 8), b.outro.lojaId)
  usuario = b.vendedor
  assert.deepEqual(await actions.criarPedidoVendaAction([{ motoId: arquivada }, { motoId: daA }], '', RETIRA), recusa('Moto não encontrada'))
  usuario = b.socioParcial
  assert.deepEqual(await actions.criarPedidoVendaAction([{ motoId: b1 }, { motoId: doOutroGrupo }], '', RETIRA), recusa('Moto não encontrada'))
  assert.deepEqual([...await pedidosDaMoto(b1), ...await pedidosDaMoto(arquivada), ...await pedidosDaMoto(daA)], [])
})

test('D3c: pedido com várias motos e uma de outra Conta, no criar e no trocar: recusa o pedido inteiro com a frase do inexistente', async () => {
  const a = await semearConta()
  const b = await semearConta()
  const [daA] = await a.motos(1)
  const [b1, b2, b3] = await b.motos(3)
  usuario = b.vendedor
  assert.deepEqual(await actions.criarPedidoVendaAction([{ motoId: b1 }, { motoId: b2 }, { motoId: daA }], '', RETIRA), recusa('Moto não encontrada'))
  assert.deepEqual(await pedidosDaMoto(b1), [])
  assert.deepEqual(await disponibilidades([b1, b2]), { [b1]: 'disponivel', [b2]: 'disponivel' })

  const pedidoId = await criarPedido(b, [b1])
  assert.deepEqual(await actions.trocarMotosDoPedidoAction(pedidoId, [{ motoId: b1 }, { motoId: b2 }, { motoId: daA }, { motoId: b3 }]), recusa('Moto não encontrada'))
  assert.deepEqual(await idsDasMotos(pedidoId), [b1])
  assert.deepEqual(await disponibilidades([daA, b2, b3]), { [daA]: 'disponivel', [b2]: 'disponivel', [b3]: 'disponivel' })
})

test('D11: aux_adm efetiva 3 motos, a 1ª e a 3ª de outro CNPJ: uma venda por moto; frete, formas e caixa só na do CNPJ da loja (D-A, D2); a 1ª com o número do pedido, as outras da sequência', async () => {
  const c = await semearConta()
  const [m1, m2, m3] = await c.motos(3)
  await comPrecoMinimo(c, m1, 8000)
  await execRows(sql`update contas set transferencia_entre_grupos = true where id = ${c.base.contaId}`)
  // Itens do mesmo pedido nascem com o mesmo criado_em; entre a 2ª e a 3ª a ordem é a do id. Só a 2ª é do CNPJ da loja.
  await execRows(sql`update motos set grupo_entrada_id = ${c.outro.grupoId} where id in ${[m1, m3]}`)
  const pedidoId = await criarPedido(c, [m1, m2, m3], entregarSintetico(300))
  usuario = c.aux
  const pagamentos = [{ tipo: 'dinheiro', valor: 2300 }, { tipo: 'pix', valor: 28000 }]
  assert.deepEqual(await efetivarMotos(c, pedidoId, [{ motoId: m3, valor: 8000 }, { motoId: m1, valor: 12000 }, { motoId: m2, valor: 10000 }], pagamentos), OK)

  const vendas = await vendasDoPedido(pedidoId)
  assert.deepEqual(vendas.map(({ numero: _, ...v }) => v), porMoto([
    { moto_id: m1, valor: '12000.00', forma_pagamento: 'pedido', pagamentos: [], numero_do_pedido: true },
    { moto_id: m2, valor: '10300.00', forma_pagamento: 'multiplos', pagamentos, numero_do_pedido: false },
    { moto_id: m3, valor: '8000.00', forma_pagamento: 'pedido', pagamentos: [], numero_do_pedido: false },
  ]))
  assert.equal(new Set(vendas.map(v => v.numero).filter(n => n != null)).size, 3)
  assert.deepEqual(await execRows(sql`select l.valor, v.moto_id from lancamentos_caixa l join vendas v on v.id = l.venda_id where v.pedido_venda_id = ${pedidoId}`),
    [{ valor: '2300.00', moto_id: m2 }])
  assert.deepEqual(await motosDoPedidoNoBanco(pedidoId), porMoto([
    { moto_id: m1, valor_unitario: '12000.00' }, { moto_id: m2, valor_unitario: '10000.00' }, { moto_id: m3, valor_unitario: '8000.00' }]))
  assert.deepEqual(await execRows(sql`select distinct m.status::text, p.status as pedido from motos m, pedidos_venda p where m.id in ${[m1, m2, m3]} and p.id = ${pedidoId}`),
    [{ status: 'vendida', pedido: 'efetivado' }])
})

test('D24: a ordem em que o vendedor adicionou as motos fica gravada e decide quem leva frete, formas e caixa (Luis, 17/11): a 1ª do CNPJ da loja', async () => {
  const c = await semearConta()
  const [m1, m2, m3, m4] = await c.motos(4)
  await execRows(sql`update contas set transferencia_entre_grupos = true where id = ${c.base.contaId}`)
  await execRows(sql`update motos set grupo_entrada_id = ${c.outro.grupoId} where id = ${m1}`)
  const pedidoId = await criarPedido(c, [m1, m2, m3, m4], entregarSintetico(300))
  const itens = await execRows(sql`select moto_id, criado_em::text as criado_em from pedidos_venda_itens where pedido_venda_id = ${pedidoId} order by criado_em, id`)
  assert.deepEqual(itens.map(i => i.moto_id), [m1, m2, m3, m4])
  assert.equal(new Set(itens.map(i => i.criado_em)).size, 4)

  usuario = c.aux
  assert.deepEqual(await efetivarMotos(c, pedidoId, [m1, m2, m3, m4].map(motoId => ({ motoId, valor: 10000 })), [{ tipo: 'pix', valor: 40300 }]), OK)
  const vendas = await vendasDoPedido(pedidoId)
  assert.deepEqual(vendas.filter(v => (v.pagamentos as unknown[]).length > 0).map(v => [v.moto_id, v.valor]), [[m2, '10300.00']])
})

test('D25: na troca, a moto que entra vai para o fim; saiu a do pedido, a 1ª adicionada que fica passa a ser ela e leva o frete', async () => {
  const c = await semearConta()
  const [p, b, nova] = await c.motos(3)
  const pedidoId = await criarPedido(c, [p, b], entregarSintetico(300))
  usuario = c.aux
  assert.deepEqual(await actions.trocarMotosDoPedidoAction(pedidoId, [{ motoId: nova }, { motoId: b }]), OK)
  assert.equal(await motoDoPedido(pedidoId), b)

  assert.deepEqual(await efetivarMotos(c, pedidoId, [{ motoId: nova, valor: 10000 }, { motoId: b, valor: 10000 }], [{ tipo: 'pix', valor: 20300 }]), OK)
  const vendas = await vendasDoPedido(pedidoId)
  assert.deepEqual(vendas.filter(v => (v.pagamentos as unknown[]).length > 0).map(v => [v.moto_id, v.valor, v.numero_do_pedido]), [[b, '10300.00', true]])
})

test('D12: valores que não batem com as motos do pedido (falta, sobra, moto de outra Conta, valor só) ou com o total: recusa e nenhuma venda', async () => {
  const a = await semearConta()
  const b = await semearConta()
  const [daB] = await b.motos(1)
  const [m1, m2, m3] = await a.motos(3)
  const pedidoId = await criarPedido(a, [m1, m2])
  usuario = a.aux
  const v = (motoId: string, valor = 10000) => ({ motoId, valor })
  for (const valores of [[v(m1)], [v(m1), v(m2), v(m3)], [v(m1), v(daB)], '20000']) {
    assert.deepEqual(await efetivarMotos(a, pedidoId, valores, [{ tipo: 'pix', valor: 20000 }]), recusa('Os itens do pedido mudaram. Recarregue a página.'), JSON.stringify(valores))
  }
  assert.deepEqual(await efetivarMotos(a, pedidoId, [v(m1), v(m2, 0)], [{ tipo: 'pix', valor: 10000 }]), recusa('Valor inválido'))
  assert.deepEqual(await efetivarMotos(a, pedidoId, [v(m1), v(m2)], [{ tipo: 'pix', valor: 15000 }]), recusa(SOMA_PAGAMENTOS_DIFERE))
  assert.deepEqual(await execRows(sql`select id from vendas where pedido_venda_id = ${pedidoId}`), [])
  assert.deepEqual(await disponibilidades([m1, m2, m3, daB]), { [m1]: 'reservada', [m2]: 'reservada', [m3]: 'disponivel', [daB]: 'disponivel' })
})

test('D13: 2ª moto vendida por fora ou em transporte depois do pedido: recusa com a frase dela, nenhuma venda, a 1ª segue reservada', async () => {
  const c = await semearConta()
  const casos: [ReturnType<typeof sql>, string][] = [
    [sql`status = 'vendida', disponibilidade = null`, 'Moto já foi vendida'],
    [sql`status = 'em_transporte'`, 'Moto ainda em transporte. Não pode ser vendida.'],
  ]
  for (const [mudanca, frase] of casos) {
    const [m1, m2] = await c.motos(2)
    const pedidoId = await criarPedido(c, [m1, m2])
    await execRows(sql`update motos set ${mudanca} where id = ${m2}`)
    usuario = c.aux
    assert.deepEqual(await efetivarMotos(c, pedidoId, [{ motoId: m1, valor: 10000 }, { motoId: m2, valor: 10000 }], [{ tipo: 'pix', valor: 20000 }]), recusa(frase))
    assert.deepEqual(await execRows(sql`select id from vendas where pedido_venda_id = ${pedidoId}`), [])
    assert.equal((await disponibilidades([m1]))[m1], 'reservada')
  }
})

test('D21: cancelar e editar uma venda do pedido de 2 motos são recusados até o #23 (D-F, D-I); nada muda', async () => {
  const c = await semearConta()
  const [m1, m2] = await c.motos(2)
  const pedidoId = await criarPedido(c, [m1, m2])
  usuario = c.aux
  assert.deepEqual(await efetivarMotos(c, pedidoId, [{ motoId: m1, valor: 10000 }, { motoId: m2, valor: 10000 }], [{ tipo: 'pix', valor: 20000 }]), OK)
  const [{ id: vendaId }] = await execRows(sql`select id from vendas where moto_id = ${m2}`)
  assert.deepEqual(await actions.cancelarVendaCompletaAction(vendaId as string, 'desistiu'),
    { ok: false, error: 'Esta venda faz parte de um pedido com várias motos. O cancelamento é do pedido inteiro e ainda não está disponível.' })
  assert.deepEqual(await actions.editarVendaAction(vendaId as string, { valor: '10000', dataVenda: '2026-11-17', pagamentos: [{ tipo: 'pix', valor: 10000 }], clienteNome: 'Outro', clienteCpf: CPF }),
    recusa('Esta venda faz parte de um pedido com várias motos. A edição é do pedido inteiro e ainda não está disponível.'))
  assert.deepEqual((await vendasDoPedido(pedidoId)).map(v => ({ moto_id: v.moto_id, forma_pagamento: v.forma_pagamento })),
    porMoto([{ moto_id: m1, forma_pagamento: 'pix' }, { moto_id: m2, forma_pagamento: 'pedido' }]))
  assert.equal((await pedidosDaMoto(m2)).length, 1)
})
