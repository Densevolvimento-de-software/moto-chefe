// Editar o pedido pendente (#25, 25c): motos, peças e Entrega numa transação, com as travas da troca de motos e a regra do preço
// (decisão 4 do Luis). As actions gravam fora de transação de teste: cada cenário cria a própria Conta e só confere o que criou.
import { after, before, mock, test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { semearContaComMotos } from '@/test/semear-motos'
import { semearUsuario } from '@/test/semear-conta'
import { entregarSintetico } from '@/test/entrega-sintetica'

const url = process.env.TEST_DATABASE_URL
if (!url || !['localhost', '127.0.0.1'].includes(new URL(url).hostname)) throw new Error('Use somente Postgres descartável local')
process.env.DATABASE_URL = url
process.env.CERT_MASTER_KEY = 'a'.repeat(64)

type Usuario = { id: string; papel: string; lojaId: string | null; contaId: string; gruposAcesso: string[] }
let usuario: Usuario
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

const RETIRA = { modo: 'retira', modalidade: 'TransporteProprioPorContaDoDestinatario' } as const
const OK = { ok: true, dados: undefined }
const idDe = async (q: ReturnType<typeof sql>) => (await execRows(q))[0].id as string

async function semearConta() {
  const sufixo = randomUUID()
  const c = await semearContaComMotos(db, 'SP25C', sufixo, sufixo, sufixo + '2')
  const comum = { lojaId: c.base.lojaId, contaId: c.base.contaId, gruposAcesso: [] }
  const vendedor = { id: await semearUsuario(db, c.base, { papel: 'vendedor', rotulo: 'vend', comConta: true }), papel: 'vendedor', ...comum }
  const outroVendedor = { id: await semearUsuario(db, c.base, { papel: 'vendedor', rotulo: 'vend2', comConta: true }), papel: 'vendedor', ...comum }
  const capacete = await idDe(sql`insert into pecas_catalogo (conta_id, nome, valor) values (${c.base.contaId}, 'Capacete SP25C', '250.00') returning id`)
  const antena = await idDe(sql`insert into pecas_catalogo (conta_id, nome, valor) values (${c.base.contaId}, 'Antena SP25C', '40.00') returning id`)
  return { ...c, vendedor, outroVendedor, capacete, antena, moto: () => c.novaMoto(randomUUID().slice(0, 8)) }
}
type Conta = Awaited<ReturnType<typeof semearConta>>
type Peca = { tipo: 'brinde' | 'acessorio'; pecaId: string; quantidade: number; valorUnitario?: number }

async function criar(c: Conta, motos: { motoId: string; valor?: number }[], pecas: Peca[] = [], quem: Usuario = c.vendedor) {
  usuario = quem
  assert.deepEqual(await actions.criarPedidoVendaAction(motos, '', RETIRA, pecas), OK)
  return (await execRows(sql`select p.id from pedidos_venda p join pedidos_venda_itens i on i.pedido_venda_id = p.id
    where i.moto_id = ${motos[0].motoId} and p.status = 'pendente'`))[0].id as string
}
const salvar = (quem: Usuario, pedidoId: string, motos: unknown, pecas: unknown, entrega: unknown = RETIRA) => {
  usuario = quem
  return actions.salvarPedidoPendenteAction(pedidoId, motos as never, pecas as never, entrega)
}
/** Retrato do pedido: itens, moto principal e Entrega. */
const retrato = async (pedidoId: string) => ({
  itens: await execRows(sql`select tipo, moto_id, peca_id, quantidade, valor_unitario from pedidos_venda_itens
    where pedido_venda_id = ${pedidoId} order by tipo, moto_id, peca_id`),
  pedido: (await execRows(sql`select moto_id, entrega from pedidos_venda where id = ${pedidoId}`))[0],
})
const disp = async (ids: string[]) =>
  Object.fromEntries((await execRows(sql`select id, disponibilidade from motos where id = any(${sql.param(ids)}::uuid[])`)).map(r => [r.id, r.disponibilidade]))

test('E1: o vendedor troca a moto, muda valor, põe e tira peça e muda a Entrega numa vez só', async () => {
  const c = await semearConta()
  const [m1, m2, m3] = [await c.moto(), await c.moto(), await c.moto()]
  const pedidoId = await criar(c, [{ motoId: m1, valor: 9000 }, { motoId: m2 }], [{ tipo: 'acessorio', pecaId: c.capacete, quantidade: 1 }])
  // Campos a mais (vindos do navegador) não entram.
  const r = await salvar(c.vendedor, pedidoId,
    [{ motoId: m2, valor: 8000, lojaId: randomUUID() }, { motoId: m3, valor: 7000 }],
    [{ tipo: 'acessorio', pecaId: c.capacete, quantidade: 2, pedidoVendaId: randomUUID() }, { tipo: 'brinde', pecaId: c.antena, quantidade: 1 }],
    entregarSintetico(150))
  assert.deepEqual(r, OK)
  const { itens, pedido } = await retrato(pedidoId)
  assert.deepEqual(itens.filter(i => i.tipo === 'moto').map(i => [i.moto_id, i.valor_unitario]).sort(), [[m2, '8000.00'], [m3, '7000.00']].sort())
  assert.deepEqual(itens.filter(i => i.tipo !== 'moto').map(i => [i.tipo, i.peca_id, i.quantidade, i.valor_unitario]),
    [['acessorio', c.capacete, '2.00', '250.00'], ['brinde', c.antena, '1.00', '0.00']])
  assert.equal(pedido.moto_id, m2)
  assert.equal((pedido.entrega as { frete?: number }).frete, 150)
  assert.deepEqual(await disp([m1, m2, m3]), { [m1]: 'disponivel', [m2]: 'reservada', [m3]: 'reservada' })
})

test('E2: o preço ajustado por gestor fica quando o vendedor edita; peça nova entra pelo catálogo; o gestor ajusta', async () => {
  const c = await semearConta()
  const m1 = await c.moto()
  const pedidoId = await criar(c, [{ motoId: m1 }], [{ tipo: 'acessorio', pecaId: c.capacete, quantidade: 1 }])
  assert.deepEqual(await salvar(c.aux, pedidoId, [{ motoId: m1 }], [{ tipo: 'acessorio', pecaId: c.capacete, quantidade: 1, valorUnitario: 200 }]), OK)
  assert.deepEqual(await salvar(c.vendedor, pedidoId, [{ motoId: m1 }],
    [{ tipo: 'acessorio', pecaId: c.capacete, quantidade: 3, valorUnitario: 1 }, { tipo: 'acessorio', pecaId: c.antena, quantidade: 1, valorUnitario: 1 }]), OK)
  const { itens } = await retrato(pedidoId)
  assert.deepEqual(itens.filter(i => i.tipo !== 'moto').map(i => [i.peca_id, i.quantidade, i.valor_unitario]).sort(),
    [[c.capacete, '3.00', '200.00'], [c.antena, '1.00', '40.00']].sort())
})

test('E3: falha numa parte (peça de outra Conta) não grava nada: motos, peças e Entrega ficam como estavam', async () => {
  const c = await semearConta()
  const b = await semearConta()
  const [m1, m2] = [await c.moto(), await c.moto()]
  const pedidoId = await criar(c, [{ motoId: m1, valor: 9000 }], [{ tipo: 'acessorio', pecaId: c.capacete, quantidade: 1 }])
  const antes = await retrato(pedidoId)
  const r = await salvar(c.vendedor, pedidoId, [{ motoId: m2, valor: 1000 }], [{ tipo: 'acessorio', pecaId: b.capacete, quantidade: 1 }], entregarSintetico(150))
  assert.deepEqual(r, { ok: false, erro: 'Peça não encontrada' })
  assert.deepEqual(await retrato(pedidoId), antes)
  assert.deepEqual(await disp([m1, m2]), { [m1]: 'reservada', [m2]: 'disponivel' })
})

test('E4: lista sem moto, pedido em aprovação e pedido que não está pendente recusam com frase; nada muda', async () => {
  const c = await semearConta()
  const m1 = await c.moto()
  const pedidoId = await criar(c, [{ motoId: m1, valor: 9000 }])
  const antes = await retrato(pedidoId)
  assert.deepEqual(await salvar(c.vendedor, pedidoId, [], []), { ok: false, erro: 'O pedido precisa de ao menos uma moto. Para desistir, cancele o pedido.' })
  await execRows(sql`insert into aprovacoes_venda (origem, moto_id, loja_id, vendedor_id, valor, dados_venda, motivo)
    values ('pedido', ${m1}, ${c.base.lojaId}, ${c.vendedor.id}, '9000', ${JSON.stringify({ pedidoId })}::jsonb, 'teste') returning id`)
  assert.deepEqual(await salvar(c.vendedor, pedidoId, [{ motoId: m1, valor: 8000 }], []),
    { ok: false, erro: 'Este pedido está aguardando aprovação. Aprove ou recuse antes de editar o pedido.' })
  await execRows(sql`update aprovacoes_venda set status = 'recusada' where dados_venda->>'pedidoId' = ${pedidoId} returning id`)
  await execRows(sql`update pedidos_venda set status = 'cancelado' where id = ${pedidoId} returning id`)
  assert.deepEqual(await salvar(c.vendedor, pedidoId, [{ motoId: m1, valor: 8000 }], []), { ok: false, erro: 'Este pedido não está mais pendente. Recarregue a página.' })
  assert.deepEqual((await retrato(pedidoId)).itens, antes.itens)
})

test('E5: moto de outra loja da Conta ou já reservada não entra; nada muda', async () => {
  const c = await semearConta()
  const [m1, reservada] = [await c.moto(), await c.moto()]
  const deOutraLoja = await c.novaMoto(randomUUID().slice(0, 8), c.outro.lojaId)
  const pedidoId = await criar(c, [{ motoId: m1, valor: 9000 }])
  await criar(c, [{ motoId: reservada }])
  const antes = await retrato(pedidoId)
  for (const motoId of [deOutraLoja, reservada]) {
    usuario = c.aux
    const r = await salvar(c.aux, pedidoId, [{ motoId: m1 }, { motoId }], [])
    assert.equal(r.ok, false, 'a moto não entra')
  }
  assert.deepEqual(await retrato(pedidoId), antes)
})

test('E6: quem edita é quem cancela: o vendedor só o pedido que criou; mecânico não', async () => {
  const c = await semearConta()
  const m1 = await c.moto()
  const pedidoId = await criar(c, [{ motoId: m1, valor: 9000 }])
  const semPermissao = { ok: false, erro: 'Sem permissão para alterar este pedido' }
  assert.deepEqual(await salvar(c.outroVendedor, pedidoId, [{ motoId: m1, valor: 1 }], []), semPermissao)
  assert.deepEqual(await salvar({ ...c.vendedor, papel: 'mecanico' }, pedidoId, [{ motoId: m1, valor: 1 }], []), semPermissao)
  assert.deepEqual(await salvar(c.aux, pedidoId, [{ motoId: m1, valor: 8500 }], []), OK)
})

test('E7: Conta B não edita o pedido da A nem põe moto da A no seu; mesma frase do inexistente e nada muda nas duas', async () => {
  const a = await semearConta()
  const b = await semearConta()
  const [ma, mb] = [await a.moto(), await b.moto()]
  const pedidoA = await criar(a, [{ motoId: ma, valor: 9000 }])
  const pedidoB = await criar(b, [{ motoId: mb, valor: 9000 }])
  const [antesA, antesB] = [await retrato(pedidoA), await retrato(pedidoB)]
  const naoEncontrado = { ok: false, erro: 'Pedido não encontrado' }
  for (const id of [pedidoA, randomUUID(), 'nao-e-uuid']) assert.deepEqual(await salvar(b.aux, id, [{ motoId: mb }], []), naoEncontrado, id)
  assert.deepEqual(await salvar(b.aux, pedidoB, [{ motoId: mb }, { motoId: ma }], []), { ok: false, erro: 'Moto não encontrada' })
  assert.deepEqual([await retrato(pedidoA), await retrato(pedidoB)], [antesA, antesB])
  assert.deepEqual(await disp([ma]), { [ma]: 'reservada' })
})
