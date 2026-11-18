// Semeadura dos testes de banco do pedido efetivado (#23): Conta com motos, vendedor, origem e um capacete no estoque, e um
// pedido efetivado pelas actions de verdade, com a persona trocada por quem chama.
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { semearContaComMotos } from '@/test/semear-motos'
import { semearUsuario } from '@/test/semear-conta'
import { entregarSintetico } from '@/test/entrega-sintetica'

type Db = typeof import('@/lib/db')
type Actions = Pick<typeof import('@/app/(dashboard)/vendas/actions'), 'criarPedidoVendaAction' | 'efetivarVendaAction'>
type Persona = { id: string; papel: string; lojaId: string | null; gruposAcesso: string[]; contaId: string }

export const CPF_SINTETICO = '529.982.247-25'

/** Conta com vendedor, origem e um capacete do catálogo (R$ 250) com 5 no estoque da loja. */
export async function semearContaDoPedido({ db, execRows }: Pick<Db, 'db' | 'execRows'>, prefixo: string) {
  const idDe = async (q: ReturnType<typeof sql>) => (await execRows(q))[0].id as string
  const c = await semearContaComMotos(db, prefixo, randomUUID(), randomUUID(), randomUUID())
  const vendedorId = await semearUsuario(db, c.base, { papel: 'vendedor', rotulo: 'vend' })
  const origemId = await idDe(sql`insert into origens_venda (grupo_id, nome) values (${c.base.grupoId}, 'Passou na porta') returning id`)
  const capacete = await idDe(sql`insert into pecas_catalogo (conta_id, nome, valor) values (${c.base.contaId}, ${'Capacete ' + prefixo}, '250.00') returning id`)
  await execRows(sql`insert into pecas_estoque_loja (peca_id, loja_id, quantidade) values (${capacete}, ${c.base.lojaId}, 5)`)
  return {
    ...c, origemId, capacete,
    vendedor: { id: vendedorId, papel: 'vendedor', lojaId: c.base.lojaId, gruposAcesso: [], contaId: c.base.contaId } as Persona,
    motos: (n: number) => Promise.all(Array.from({ length: n }, () => c.novaMoto(randomUUID().slice(0, 8)))),
  }
}
export type ContaDoPedido = Awaited<ReturnType<typeof semearContaDoPedido>>

/**
 * Pedido criado pelo vendedor e efetivado pelo aux_adm: cada moto a R$ 10.000, 2 capacetes a R$ 250 e o frete dado; pagamento
 * R$ 1.000 em dinheiro e o resto em PIX. Devolve o pedido e as vendas.
 */
export async function efetivarPedidoSintetico(
  { execRows }: Pick<Db, 'execRows'>, actions: Actions, como: (p: Persona) => void, c: ContaDoPedido, motoIds: string[], frete = 0,
) {
  como(c.vendedor)
  const pecas = [{ tipo: 'acessorio' as const, pecaId: c.capacete, quantidade: 2 }]
  const entrega = frete > 0 ? entregarSintetico(frete) : { modo: 'retira', modalidade: 'TransporteProprioPorContaDoDestinatario' }
  assert.equal((await actions.criarPedidoVendaAction(motoIds.map(motoId => ({ motoId })), '', entrega, pecas)).ok, true)
  const pedidoId = (await execRows(sql`select pedido_venda_id as id from pedidos_venda_itens where moto_id = ${motoIds[0]}`))[0].id as string
  como(c.aux)
  const total = motoIds.length * 10000 + 500 + frete
  const r = await actions.efetivarVendaAction(pedidoId, 'Cliente sintético', CPF_SINTETICO, motoIds.map(motoId => ({ motoId, valor: 10000 })),
    [{ tipo: 'dinheiro', valor: 1000 }, { tipo: 'pix', valor: total - 1000 }], undefined, c.origemId)
  assert.deepEqual(r, { ok: true, dados: undefined })
  const vendas = await execRows(sql`select id, moto_id, forma_pagamento from vendas where pedido_venda_id = ${pedidoId}`)
  return {
    pedidoId,
    vendaDa: (motoId: string) => vendas.find(v => v.moto_id === motoId)!.id as string,
    vendaIds: vendas.map(v => v.id as string),
    vendaDoPagamento: vendas.find(v => v.forma_pagamento !== 'pedido')!.id as string,
  }
}
