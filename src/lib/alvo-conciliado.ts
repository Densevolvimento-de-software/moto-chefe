import { and, eq } from 'drizzle-orm'
import type { db } from '@/lib/db'
import { conciliacoesCartao, pixRecebimentosMcp } from '@/lib/db/schema'

type Executor = Pick<typeof db, 'select'>
export type AlvoTipo = 'moto' | 'peca' | 'os'
/** Venda de moto, venda de peças ou OS: o que uma linha de cartão ou um PIX do banco cobre. */
export type AlvoConciliacao = { tipo: AlvoTipo; id: string }

/** Colunas que ligam a linha de cartão e o PIX do banco ao alvo. */
export const colunasDoAlvo = (alvo: AlvoConciliacao) =>
  alvo.tipo === 'peca' ? { cartao: conciliacoesCartao.pecaVendaId, pix: pixRecebimentosMcp.pecaVendaId }
  : alvo.tipo === 'os' ? { cartao: conciliacoesCartao.osId, pix: pixRecebimentosMcp.osId }
  : { cartao: conciliacoesCartao.vendaId, pix: pixRecebimentosMcp.vendaId }

/**
 * A venda, venda de peças ou OS está ligada a algum recebimento (linha de cartão conciliada ou PIX do banco)? Linha
 * estornada no Mercado Pago não conta: o estorno zera o `conciliado` (#51). Para o aviso da edição e a trava da OS.
 */
export async function alvoConciliado(exec: Executor, alvo: AlvoConciliacao): Promise<boolean> {
  const { cartao, pix } = colunasDoAlvo(alvo)
  const [linhasCartao, linhasPix] = await Promise.all([
    exec.select({ id: conciliacoesCartao.id }).from(conciliacoesCartao).where(and(eq(cartao, alvo.id), eq(conciliacoesCartao.conciliado, true))).limit(1),
    exec.select({ id: pixRecebimentosMcp.id }).from(pixRecebimentosMcp).where(eq(pix, alvo.id)).limit(1),
  ])
  return linhasCartao.length + linhasPix.length > 0
}
