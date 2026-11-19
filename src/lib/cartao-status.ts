import { and, eq, ne } from 'drizzle-orm'
import { conciliacoesCartao } from '@/lib/db/schema'
import { CARTAO_ESTORNADO, LINHA_PIX } from '@/lib/conciliacao-cartao'

// Venda devolvida ao cliente (estorno do Mercado Pago). A linha continua ligada à venda/OS/peça e aparece na lista "Todas",
// mas o dinheiro voltou: não é pendência, não é candidata a vínculo e o servidor recusa vinculá-la
// (vincular poria o valor de volta nas somas, que só olham `conciliado = true`). A tela decide por `linhaEstornada`.
/** Condição Drizzle: linha de cartão que não foi estornada. */
export const cartaoNaoEstornado = ne(conciliacoesCartao.status, CARTAO_ESTORNADO)

/** Condição Drizzle: pendência de cartão (sem vínculo conciliado e não estornada). */
export const cartaoPendente = and(eq(conciliacoesCartao.conciliado, false), cartaoNaoEstornado)!

/**
 * Condição Drizzle: linha de cartão (crédito ou débito), sem a linha Pix da maquininha Mercado Pago
 * (#51), que cobre pagamento Pix. As buscas do painel da venda para pagamento de cartão usam esta.
 */
export const linhaDeCartao = ne(conciliacoesCartao.tipo, LINHA_PIX)
