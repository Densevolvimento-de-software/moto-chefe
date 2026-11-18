import type { PagamentoMp } from './mercadopago/point'
import { dataBrt, LINHA_PIX, type TransacaoCartao } from './conciliacao-cartao'
import { ehEstornoMp } from './mercadopago/status'

// Uma linha de conciliacoes_cartao: cartão (crédito/débito) ou Pix da maquininha (decisão do Luis, #51).
export type Classificacao =
  | { tipo: 'transacao'; transacao: TransacaoCartao }
  | { tipo: 'estorno'; chave: string }
  | { tipo: 'nao_tratado'; motivo: string }
  | { tipo: 'ignorar'; motivo: string }

/**
 * Única regra de "veio da maquininha". Na conta real (#51, 18/11/2026) o cartão vem com
 * point_of_interaction.type 'POINT' e o Pix com 'INSTORE', os dois com o serial do aparelho; o link de
 * pagamento vem 'CHECKOUT', sem serial. Por isso vale 'POINT' ou serial.
 */
export function ehDaMaquininha(p: PagamentoMp): boolean {
  const poi = p.point_of_interaction
  return poi?.type === 'POINT' || Boolean(poi?.device?.serial_number)
}

const MEIO_DA_LINHA: Record<string, TransacaoCartao['tipo']> = { credit_card: 'credito', debit_card: 'debito' }

const tipoDaLinha = (p: PagamentoMp): TransacaoCartao['tipo'] | null =>
  p.payment_method_id === 'pix' ? LINHA_PIX : MEIO_DA_LINHA[p.payment_type_id] ?? null

export function classificarPagamento(p: PagamentoMp): Classificacao {
  if (!ehDaMaquininha(p)) return { tipo: 'ignorar', motivo: 'não é da maquininha' }
  // A chave é a mesma do nsu gravado: o estorno acha a linha, seja cartão ou Pix.
  if (ehEstornoMp(p.status)) return { tipo: 'estorno', chave: String(p.id) }
  if (p.status !== 'approved') return { tipo: 'ignorar', motivo: `status ${p.status}` }
  if (!p.date_approved) return { tipo: 'ignorar', motivo: 'aprovado sem data de aprovação' }

  const tipo = tipoDaLinha(p)
  // Venda aprovada que não vira linha conta no resumo da importação: nada some calado (decisão do Luis, #51).
  if (!tipo) {
    return { tipo: 'nao_tratado', motivo: p.payment_type_id === 'prepaid_card' ? 'cartão pré-pago' : `meio ${p.payment_type_id}` }
  }
  // Linha conciliada sem líquido conta o bruto inteiro como taxa (src/lib/queries/valor-liquido.ts): melhor a
  // loja ver a venda no resumo e conciliar à mão (condição do PR4 na #51).
  const valorLiquido = p.transaction_details?.net_received_amount
  if (valorLiquido == null) return { tipo: 'nao_tratado', motivo: 'sem valor líquido' }

  return {
    tipo: 'transacao',
    transacao: {
      nsu: String(p.id),
      autorizacao: p.authorization_code ?? undefined,
      dataTransacao: dataBrt(p.date_approved),
      valorBruto: p.transaction_amount,
      valorLiquido,
      parcelas: tipo === 'credito' ? p.installments || 1 : 1,
      tipo,
      status: 'aprovado',
      rawData: {
        id: p.id,
        bandeira: p.payment_method_id,
        serial: p.point_of_interaction?.device?.serial_number ?? null,
        ultimos4: p.card?.last_four_digits ?? null,
        estornado: p.transaction_amount_refunded ?? 0,
      },
    },
  }
}
