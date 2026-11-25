import { and, eq, ne } from 'drizzle-orm'
import { conciliacoesCartao } from '@/lib/db/schema'
import { CARTAO_ESTORNADO, LINHA_PIX, type LinhaProcurada } from '@/lib/conciliacao-cartao'

// Venda devolvida ao cliente (estorno do Mercado Pago). A linha continua ligada à venda/OS/peça e aparece na lista "Todas",
// mas o dinheiro voltou: não é pendência, não é candidata a vínculo e o servidor recusa vinculá-la
// (vincular poria o valor de volta nas somas, que só olham `conciliado = true`). A tela decide por `linhaEstornada`.

/** Condição Drizzle: linha de cartão que não foi estornada. */
export const cartaoNaoEstornado = ne(conciliacoesCartao.status, CARTAO_ESTORNADO)

/** Condição Drizzle: pendência de cartão (sem vínculo conciliado e não estornada). */
export const cartaoPendente = and(eq(conciliacoesCartao.conciliado, false), cartaoNaoEstornado)!

/**
 * Condição Drizzle: linha de pagamento da conciliação, sem a linha Pix da maquininha Mercado Pago (#51).
 * Inclui cartão e saldo MP; as buscas do painel usam esta para os pagamentos que não são Pix.
 */
export const linhaDeCartao = ne(conciliacoesCartao.tipo, LINHA_PIX)

/** Condição Drizzle: a linha que cobre o pagamento procurado (cartão ou a linha pix da maquininha). */
export const linhaDoPagamento = (linha: LinhaProcurada) => (linha === 'pix' ? eq(conciliacoesCartao.tipo, LINHA_PIX) : linhaDeCartao)
