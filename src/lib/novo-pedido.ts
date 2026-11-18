import { filtrarPecas } from './busca-peca'
import { centavos } from './numero-br'
import { finalDoChassi } from './painel-fabrica'
import type { PecaComSaldo } from './pecas-da-conta'
import { totalDasPecas, valorDeMotoInvalido, valorDePecaInvalido, type MotoDoPedidoInput, type PecaDoPedidoInput } from './pedido-venda-regras'

/** Moto disponível que o Novo pedido oferece (#24). */
export type MotoDisponivel = { id: string; chassi: string; marca: string; modelo: string; cor: string; lojaId: string; lojaNome: string }
/** Moto já no pedido; `valor` é o texto do campo de dinheiro ("9490.00"), vazio = sem valor (D-E2 da #20). */
export type MotoNoPedido = MotoDisponivel & { valor: string }

export const detalheDaMoto = (m: MotoDisponivel) => `Chassi final ${finalDoChassi(m.chassi)}, ${m.cor.toLowerCase()}`

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

/** Brinde ou acessório no pedido; `valor` é o texto do campo de dinheiro (o brinde fica "0.00"). */
export type PecaNoPedido = { tipo: 'brinde' | 'acessorio'; peca: PecaComSaldo; quantidade: number; valor: string }

/** As marcadas no painel entram no pedido; a mesma peça do mesmo tipo soma na quantidade. Acessório começa no preço do catálogo. */
export function comPecas(atual: readonly PecaNoPedido[], tipo: PecaNoPedido['tipo'], marcadas: readonly { peca: PecaComSaldo; quantidade: number }[]): PecaNoPedido[] {
  return marcadas.reduce<PecaNoPedido[]>((lista, { peca, quantidade }) => (lista.some(p => p.tipo === tipo && p.peca.id === peca.id)
    ? lista.map(p => (p.tipo === tipo && p.peca.id === peca.id ? { ...p, quantidade: p.quantidade + quantidade } : p))
    : [...lista, { tipo, peca, quantidade, valor: tipo === 'brinde' ? '0.00' : peca.valor }]), [...atual])
}

/** Saldo que passa do estoque da loja: avisa, não bloqueia (#778). A peça conta como brinde e como acessório. */
export function avisoDeSaldo(pecas: readonly PecaNoPedido[], pecaId: string): string | null {
  const da = pecas.filter(p => p.peca.id === pecaId)
  const sobra = (da[0]?.peca.quantidadeEstoque ?? 0) - da.reduce((s, p) => s + p.quantidade, 0)
  return da.length > 0 && sobra < 0 ? `Saldo na loja: ${da[0].peca.quantidadeEstoque}. Fica em ${sobra} depois deste pedido; não trava a venda.` : null
}

/** Peças para o criar pedido. O valor do acessório só vai de quem gere peças, como o servidor (#778); null se um valor não serve. */
export function pecasDoEnvio(pecas: readonly PecaNoPedido[], podeAjustarPreco: boolean): PecaDoPedidoInput[] | null {
  const ajusta = (p: PecaNoPedido) => p.tipo === 'acessorio' && podeAjustarPreco
  if (pecas.some(p => ajusta(p) && valorDePecaInvalido(Number(p.valor)))) return null
  return pecas.map(p => ({ tipo: p.tipo, pecaId: p.peca.id, quantidade: p.quantidade, ...(ajusta(p) ? { valorUnitario: Number(p.valor) } : {}) }))
}

export const totalDasPecasNaTela = (pecas: readonly PecaNoPedido[]): number =>
  totalDasPecas(pecas.map(p => ({ quantidade: p.quantidade, valorUnitario: p.valor })))

/** Linha do Resumo com as motos "A definir" (decisão do Luis, #24): avisa, não bloqueia. */
export function motosSemValor(motos: readonly MotoNoPedido[]): string | null {
  const n = motos.filter(m => m.valor === '').length
  return n === 0 ? null : n === 1 ? '1 moto sem valor' : `${n} motos sem valor`
}
