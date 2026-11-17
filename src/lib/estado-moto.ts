// src/lib/estado-moto.ts
import { STATUS_DE_ESTOQUE, type StatusDeEstoque } from './status-moto'
import type { PapelDoBanco } from '@/lib/rotulo-do-papel'

export type Status = StatusDeEstoque
export type Disponibilidade = 'disponivel' | 'reservada' | 'vendida' | 'aguardando_aprovacao'

// Do enum do banco: papel novo não precisa de outra lista aqui (só admin e aux_adm mudam estado).
type Papel = PapelDoBanco

const isAdmin = (p: Papel) => p === 'admin_geral' || p === 'admin_socio'

// Transições de status físico (Aux Adm + Admin)
const transicoesNormais: Partial<Record<Status, Status[]>> = {
  em_transporte: ['caixa'],
  caixa:       ['montada'],
  montada:     ['em_garantia'],
  em_garantia: ['montada'],
}

// Transições de correção (Admin apenas)
const transicoesCorrecao: Partial<Record<Status, Status[]>> = {
  montada: ['caixa'],
}

export function getTransicoesStatusPermitidas(
  statusAtual: Status,
  papel: Papel,
  isMinhaLoja: boolean
): Status[] {
  if (!isMinhaLoja && !isAdmin(papel)) return []

  if (isAdmin(papel)) {
    return [
      ...(transicoesNormais[statusAtual] ?? []),
      ...(transicoesCorrecao[statusAtual] ?? []),
    ]
  }

  if (papel === 'aux_adm') {
    return transicoesNormais[statusAtual] ?? []
  }

  return []
}

/**
 * Motivo pelo qual a pessoa não pode marcar a chegada desta moto (botão Chegou), ou null. A tela e a
 * action passam por aqui. O status vem antes: a correção montada → caixa do admin não é chegada.
 */
export function motivoParaNaoMarcarChegada(status: string, papel: Papel, isMinhaLoja: boolean): string | null {
  if (status !== 'em_transporte') return 'Esta moto não está mais em transporte.'
  if (!getTransicoesStatusPermitidas(status, papel, isMinhaLoja).includes('caixa')) {
    return 'Sem permissão para marcar a chegada desta moto.'
  }
  return null
}

// Transições de disponibilidade (Aux Adm + Admin, apenas motos montadas)
export function getTransicoesDisponibilidadePermitidas(
  statusAtual: Status,
  dispAtual: Disponibilidade | null,
  papel: Papel,
  isMinhaLoja: boolean
): Disponibilidade[] {
  if (statusAtual !== 'montada') return []
  if (!isAdmin(papel)) return []
  if (dispAtual === 'vendida') return []

  if (dispAtual === null) return ['disponivel']
  if (dispAtual === 'disponivel') return ['reservada']
  if (dispAtual === 'reservada') return ['disponivel']
  return []
}

// ─── Trava: moto com venda registrada não volta a ser estoque ────────────────
//
// Em 24/08/2026 a JetMax LYDAE3936T1207627 foi remontada quatro dias depois de
// vendida e faturada, e reapareceu no Showroom como disponível — pronta pra ser
// vendida de novo. As transições acima não pegam esse caso: elas olham só o
// motos.status, e o status já tinha sido revertido para 'caixa' por fora. A
// fonte da verdade de "esta moto saiu" é a tabela vendas, não o status.

/** O que a trava precisa saber da venda não cancelada vinculada à moto. */
export type VendaVinculada = { numero: number; notaFiscalSaida: string | null }

/**
 * Retorna o motivo pelo qual esta alteração de estoque deve ser recusada, ou
 * null se ela é permitida. `alteracao` traz só os campos que estão sendo
 * mexidos — chave ausente significa "não estou tocando nisso".
 */
export function motivoBloqueioPorVenda(
  venda: VendaVinculada | null,
  alteracao: { status?: string; disponibilidade?: string | null },
): string | null {
  if (!venda) return null

  const mexeEmStatus = alteracao.status !== undefined
  const mexeEmDisponibilidade = alteracao.disponibilidade !== undefined
  if (!mexeEmStatus && !mexeEmDisponibilidade) return null

  // O estado correto de uma moto vendida: status 'vendida', e disponibilidade
  // nula até a NF de saída sair, 'vendida' depois dela. Escrever esse mesmo
  // estado é permitido — senão a trava impediria a confirmação de NF e a
  // própria correção de uma moto que ficou com o estado torto.
  const statusOk = !mexeEmStatus || alteracao.status === 'vendida'
  const disponibilidadeEsperada = venda.notaFiscalSaida ? 'vendida' : null
  const disponibilidadeOk =
    !mexeEmDisponibilidade || alteracao.disponibilidade === disponibilidadeEsperada
  if (statusOk && disponibilidadeOk) return null

  return `Moto já vendida na venda nº ${venda.numero} — não pode voltar ao estoque. Se a venda foi um engano, cancele a venda primeiro; o cancelamento devolve a moto ao Showroom.`
}

const NAO_VENDE_POR_STATUS: Partial<Record<string, string>> = {
  caixa: 'Moto ainda não foi montada. Não pode ser vendida.',
  em_transporte: 'Moto ainda em transporte. Não pode ser vendida.',
}

/**
 * Motivo pelo qual o status físico da moto impede a venda, ou null. Venda direta, pedido de venda,
 * pedido de aprovação e o botão Vender da tela passam por aqui. Moto já vendida e disponibilidade
 * ficam com cada chamador, que tem frase própria para elas.
 */
export function motivoParaNaoVender(status: string): string | null {
  return NAO_VENDE_POR_STATUS[status] ?? null
}

const AVISO_VENDA_BARRADA: Partial<Record<string, { titulo: string; texto: string }>> = {
  caixa: {
    titulo: 'A moto voltou ao estoque, mas ainda está em caixa',
    texto: 'Moto em caixa não pode ser vendida. Use o botão Montar e depois o Vender.',
  },
  em_transporte: {
    titulo: 'A moto voltou ao estoque, mas ainda está em transporte',
    texto: 'Moto em transporte não pode ser vendida. Marque a chegada, monte e depois venda.',
  },
}

/**
 * Aviso da moto que voltou ao estoque pelo painel de vendidas sem venda (?vender=1) e que o status
 * ainda não deixa vender, ou null se ela vende.
 */
export function avisoVendaBarrada(status: string): { titulo: string; texto: string } | null {
  return AVISO_VENDA_BARRADA[status] ?? null
}

const NAO_TRANSFERE_POR_STATUS: Partial<Record<string, string>> = {
  em_transporte: 'Moto ainda em transporte. Marque a chegada antes de transferir.',
  vendida: 'Moto já foi vendida',
}

/**
 * Motivo pelo qual o status físico da moto impede pedir a transferência, ou null. O servidor, o
 * botão da tela e a lista de motos do diálogo de transferência passam por aqui.
 */
export function motivoParaNaoTransferir(status: string): string | null {
  return NAO_TRANSFERE_POR_STATUS[status] ?? null
}

// Os status de estoque que a função abrir_garantia do banco recusa. O banco continua como última rede
// (e é quem recusa o legado 'reservada', sem motos hoje).
const NAO_ABRE_GARANTIA_POR_STATUS: Partial<Record<string, string>> = {
  em_transporte: 'Moto ainda em transporte. Garantia só depois da chegada.',
  caixa: 'Moto ainda não foi montada. Garantia só depois da montagem.',
}

/**
 * Motivo pelo qual o status físico da moto impede abrir garantia, ou null. A action e o botão da tela
 * passam por aqui.
 */
export function motivoParaNaoAbrirGarantia(status: string): string | null {
  return NAO_ABRE_GARANTIA_POR_STATUS[status] ?? null
}

/**
 * Motivo pelo qual a moto não pode receber um pedido de aprovação de venda, ou
 * null se pode. Moto 'reservada' é aceita de propósito: é assim que se finaliza
 * uma reserva abaixo do mínimo ou com transferência. A aprovação converte a
 * reserva ativa (criarVendaTx) e a recusa devolve a moto a 'reservada'.
 */
export function motivoBloqueioPedidoAprovacao(
  moto: { status: string; disponibilidade: string | null },
): string | null {
  const porStatus = motivoParaNaoVender(moto.status)
  if (porStatus) return porStatus
  if (moto.status === 'vendida') return 'Moto já foi vendida'
  if (moto.disponibilidade === 'aguardando_aprovacao') return 'Esta moto já tem uma venda aguardando aprovação'
  return null
}

/**
 * Motivo pelo qual a reserva da moto não pode ser cancelada agora, ou null se
 * pode. Com venda aguardando aprovação, o pedido pode ter saído da própria
 * reserva: cancelar no meio deixa a recusa devolvendo a moto a 'reservada' sem
 * reserva ativa, e a aprovação gerando venda sem reserva_id que ainda lança a
 * entrada da reserva cancelada.
 */
export function motivoBloqueioCancelarReserva(
  moto: { disponibilidade: string | null },
): string | null {
  if (moto.disponibilidade === 'aguardando_aprovacao') {
    return 'Esta moto tem uma venda aguardando aprovação. A venda precisa ser aprovada ou recusada antes de cancelar a reserva.'
  }
  return null
}

/**
 * Disponibilidade da moto quando a última reserva ativa é cancelada. Moto que ainda não pode ser
 * vendida (na caixa, em transporte) volta sem disponibilidade; "disponivel" a poria à venda.
 */
export function disponibilidadeAposCancelarReserva(status: string): Disponibilidade | null {
  return motivoParaNaoVender(status) ? null : 'disponivel'
}

export const statusLabel = Object.fromEntries(STATUS_DE_ESTOQUE.map(s => [s.valor, s.rotulo])) as Record<Status, string>

export const disponibilidadeLabel: Record<Disponibilidade, string> = {
  disponivel:            'Disponível',
  reservada:             'Reservada',
  vendida:               'Vendida',
  aguardando_aprovacao:  'Aguardando aprovação',
}
