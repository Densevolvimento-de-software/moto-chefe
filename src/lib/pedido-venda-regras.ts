import { centavos } from '@/lib/numero-br'
import { freteDaVenda, type EntregaVenda } from '@/lib/notagateway/entrega'

// Regras puras do pedido de venda, sem banco: usadas pela action (servidor) e pelo
// cartão do pedido (cliente), para a tela e o servidor não divergirem de novo (#181:
// a tela mostrava "Cancelar" ao sócio e o banco recusava).
import { motivoParaNaoVender } from './estado-moto'

const PAPEIS_QUE_CRIAM_PEDIDO = ['admin_geral', 'admin_socio', 'aux_adm', 'vendedor']

/** Quem pode abrir pedido de venda (tela e servidor usam a mesma regra). */
export function podeCriarPedido(papel: string): boolean {
  return PAPEIS_QUE_CRIAM_PEDIDO.includes(papel)
}

const PAPEIS_QUE_EFETIVAM = ['admin_geral', 'admin_socio', 'aux_adm']

/** Quem efetiva o pedido e, na efetivação, muda a Entrega dele (#895); tela e servidor usam a mesma regra. */
export function podeEfetivarPedido(papel: string): boolean {
  return PAPEIS_QUE_EFETIVAM.includes(papel)
}

export type QuemCancela = { id: string; papel: string; lojaId: string | null }
export type PedidoParaCancelar = { status: string; lojaId: string; vendedorId: string }

export function podeCancelarPedido(usuario: QuemCancela, pedido: PedidoParaCancelar): boolean {
  if (pedido.status !== 'pendente') return false
  if (usuario.papel === 'admin_geral' || usuario.papel === 'admin_socio') return true
  if (usuario.papel === 'aux_adm') return usuario.lojaId === pedido.lojaId
  if (usuario.papel === 'vendedor') return usuario.id === pedido.vendedorId && usuario.lojaId === pedido.lojaId
  return false
}

/** Tipos de item do pedido de venda (#770). O check da migração 0189 repete esta lista; o frete mora na Entrega (#779). */
export const TIPOS_ITEM_PEDIDO = ['moto', 'brinde', 'acessorio'] as const
export type TipoItemPedido = (typeof TIPOS_ITEM_PEDIDO)[number]

export type MotoParaPedido = { status: string; disponibilidade: string | null }

/** Motivo para não criar pedido com esta moto, ou null quando pode. */
export function motivoBloqueioCriarPedido(moto: MotoParaPedido, temTransferenciaPendente: boolean): string | null {
  const porStatus = motivoParaNaoVender(moto.status)
  if (porStatus) return porStatus
  if (moto.status === 'vendida') return 'Moto já foi vendida'
  if (moto.disponibilidade !== 'disponivel') {
    return `Moto não está disponível (${moto.disponibilidade ?? 'sem disponibilidade'})`
  }
  if (temTransferenciaPendente) return 'Moto tem transferência pendente'
  return null
}

/** Peça que entra no pedido (#778): brinde (R$ 0) ou acessório, do catálogo de peças da Conta. */
export type PecaDoPedidoInput = { tipo: 'brinde' | 'acessorio'; pecaId: string; quantidade: number; valorUnitario?: number }

/** Valor unitário gravado no item: brinde sempre R$ 0; acessório com o valor ajustado (já saneado) ou o do catálogo. */
export function valorDaPecaNoPedido(p: PecaDoPedidoInput, precoDoCatalogo: string): string {
  if (p.tipo === 'brinde') return '0.00'
  return p.valorUnitario != null && p.valorUnitario >= 0 ? p.valorUnitario.toFixed(2) : Number(precoDoCatalogo).toFixed(2)
}

/** Soma dos acessórios do pedido (o brinde vale R$ 0): entra no total que os pagamentos fecham. */
export function totalDasPecas(itens: readonly { quantidade: number | string; valorUnitario: number | string | null }[]): number {
  return centavos(itens.reduce((s, i) => s + Number(i.quantidade) * Number(i.valorUnitario ?? 0), 0))
}

type PecasDoTotal = Parameters<typeof totalDasPecas>[0]

/**
 * O que o cliente paga além da moto: acessórios e o frete gravado na Entrega, lido por `freteDaVenda`, o mesmo
 * de `vendas.valor`, da NF e dos relatórios. Não reconfere a modalidade: quem paga se decide na gravação
 * (`conferirEntrega` só aceita valor com a loja levando ou contratando), e FOB ou frete por conta da loja ficam
 * sem valor (#779). Também é o que não paga desconto da moto (#776).
 */
export const foraDaMoto = (entrega: EntregaVenda | null, pecas: PecasDoTotal): number =>
  centavos(freteDaVenda(entrega) + totalDasPecas(pecas))

/** Total do pedido que os pagamentos fecham: moto + frete cobrado + acessórios. */
export const totalDoPedido = (moto: number, entrega: EntregaVenda | null, pecas: PecasDoTotal): number =>
  centavos(moto + foraDaMoto(entrega, pecas))
