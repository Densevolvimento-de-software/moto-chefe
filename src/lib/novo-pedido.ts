import { filtrarPecas } from './busca-peca'
import { centavos } from './numero-br'
import { valorDeMotoInvalido, type MotoDoPedidoInput } from './pedido-venda-regras'

/** Moto disponível que o Novo pedido oferece (#24). */
export type MotoDisponivel = { id: string; chassi: string; marca: string; modelo: string; cor: string; lojaId: string; lojaNome: string }
/** Moto já no pedido; `valor` é o texto do campo de dinheiro ("9490.00"), vazio = sem valor (D-E2 da #20). */
export type MotoNoPedido = MotoDisponivel & { valor: string }

/**
 * O que o painel "Adicionar moto" lista: da loja do pedido (a da 1ª moto; o servidor recusa outra, D-H), fora as que já
 * estão nele, pela busca de modelo, cor ou final do chassi. A busca é a mesma das peças (termos, sem acento).
 */
export function motosParaAdicionar(disponiveis: readonly MotoDisponivel[], pedido: { lojaId?: string; fora: readonly string[] }, busca: string): MotoDisponivel[] {
  const candidatas = disponiveis.filter(m => !pedido.fora.includes(m.id) && (!pedido.lojaId || m.lojaId === pedido.lojaId))
  return filtrarPecas(candidatas.map(m => ({ ...m, nome: `${m.marca} ${m.modelo} ${m.cor} ${m.chassi}` })), busca, Infinity)
}

const valorDaMoto = (m: MotoNoPedido) => (m.valor === '' ? null : Number(m.valor))

/** Motos para o `criarPedidoVendaAction`, na ordem em que entraram (decide quem leva o frete, #20); null se um valor não serve. */
export function motosDoEnvio(motos: readonly MotoNoPedido[]): MotoDoPedidoInput[] | null {
  const lista = motos.map(m => ({ motoId: m.id, valor: valorDaMoto(m) }))
  if (lista.some(m => m.valor !== null && valorDeMotoInvalido(m.valor))) return null
  return lista.map(({ motoId, valor }) => (valor === null ? { motoId } : { motoId, valor }))
}

export const totalDasMotos = (motos: readonly MotoNoPedido[]): number => centavos(motos.reduce((s, m) => s + (valorDaMoto(m) ?? 0), 0))
