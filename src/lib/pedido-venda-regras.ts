import { centavos } from '@/lib/numero-br'
import { freteDaVenda, type EntregaVenda } from '@/lib/notagateway/entrega'

// Regras puras do pedido de venda, sem banco: usadas pela action (servidor) e pelo
// cartão do pedido (cliente), para a tela e o servidor não divergirem de novo (#181:
// a tela mostrava "Cancelar" ao sócio e o banco recusava).
import { motivoParaNaoVender } from './estado-moto'
import { MOTO_ARQUIVADA } from './arquivar-moto-regras'

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

const MOTO_DE_OUTRA_LOJA = 'Só motos da mesma loja no pedido. Transfira a moto antes.'
export const PEDIDO_SEM_MOTO = 'O pedido precisa de ao menos uma moto. Para desistir, cancele o pedido.'

/** Moto pedida no Novo pedido ou na troca (#20). Sem valor, o item fica nulo e a efetivação pede (D-E). */
export type MotoDoPedidoInput = { motoId: string; valor?: number }

/** A mesma moto mandada duas vezes vale uma vez, com o que veio primeiro. */
export const motosSemRepetir = (motos: readonly MotoDoPedidoInput[]): MotoDoPedidoInput[] =>
  motos.filter((m, i) => motos.findIndex(o => o.motoId === m.motoId) === i)

// O maior valor que numeric(12,2) guarda: acima disso o banco recusa com erro cru.
const MAIOR_VALOR_DO_ITEM = 9_999_999_999.99

/** Valor em reais que veio e não serve: não número, abaixo do mínimo em centavos ou maior que a coluna. Ausente é válido. */
const valorInvalido = (valor: number | undefined, minimo: number): boolean =>
  valor != null && !(Number.isFinite(valor) && centavos(valor) >= minimo && valor <= MAIOR_VALOR_DO_ITEM)

/** Valor da moto (#20, D-E): pelo menos 1 centavo. */
export const valorDeMotoInvalido = (valor: number | undefined): boolean => valorInvalido(valor, 0.01)

/** Valor ajustado da peça (#778): zero serve. */
export const valorDePecaInvalido = (valor: number | undefined): boolean => valorInvalido(valor, 0)

/** A lista de motos que chega do navegador tem a forma esperada (a Server Action recebe qualquer JSON). */
export const listaDeMotosValida = (x: unknown): x is MotoDoPedidoInput[] =>
  Array.isArray(x) && x.every(m => typeof m === 'object' && m !== null && typeof m.motoId === 'string'
    && (m.valor === undefined || typeof m.valor === 'number'))

/** Valor gravado no item moto: o que veio, já conferido, ou nulo. */
export const valorDaMotoNoPedido = (valor: number | undefined): string | null => (valor == null ? null : valor.toFixed(2))

/**
 * Motivo para a moto, lida sob a trava, não entrar num pedido da loja `lojaDoPedido` (#20, Q14), ou null quando
 * pode. Sumida ou arquivada depois da conferência da action: as frases de `travarMotoNaoArquivada`.
 */
export function motivoBloqueioMotoNoPedido(
  moto: (MotoParaPedido & { lojaId: string; arquivadaEm: Date | null }) | undefined, lojaDoPedido: string, temTransferenciaPendente: boolean,
): string | null {
  if (!moto) return 'Moto não encontrada'
  if (moto.arquivadaEm) return MOTO_ARQUIVADA
  if (moto.lojaId !== lojaDoPedido) return MOTO_DE_OUTRA_LOJA
  return motivoBloqueioCriarPedido(moto, temTransferenciaPendente)
}

/** Motos do pedido (#20): a do `moto_id` primeiro (o pedido de antes do #774 só tem ela), depois as dos itens, sem repetir. */
export function motosDoPedido(motoIdDoPedido: string, itens: readonly { motoId: string | null }[]): string[] {
  return [...new Set([motoIdDoPedido, ...itens.flatMap(i => (i.motoId ? [i.motoId] : []))])]
}

/**
 * Trocar as motos do pedido pendente (#20): quem entra, quem sai e qual fica no `moto_id` (a de antes, se
 * fica; senão a 1ª pedida). Lista pedida vazia deixa `principal` nulo: o pedido precisa de ao menos uma moto.
 */
export function trocaDeMotos(atuais: readonly string[], pedidas: readonly string[], principal: string): { entram: string[]; saem: string[]; principal: string | null } {
  const ficam = [...new Set(pedidas)]
  return {
    entram: ficam.filter(id => !atuais.includes(id)),
    saem: atuais.filter(id => !ficam.includes(id)),
    principal: ficam.includes(principal) ? principal : ficam[0] ?? null,
  }
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
