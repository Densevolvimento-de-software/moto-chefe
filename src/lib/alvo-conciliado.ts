import { and, eq } from 'drizzle-orm'
import type { db } from '@/lib/db'
import { conciliacoesCartao, pixRecebimentosMcp } from '@/lib/db/schema'

type Executor = Pick<typeof db, 'select'>
type Alvo = { tipo: 'moto' | 'peca' | 'os'; id: string }

const colunas = (alvo: Alvo) =>
  alvo.tipo === 'peca' ? { cartao: conciliacoesCartao.pecaVendaId, pix: pixRecebimentosMcp.pecaVendaId }
  : alvo.tipo === 'os' ? { cartao: conciliacoesCartao.osId, pix: pixRecebimentosMcp.osId }
  : { cartao: conciliacoesCartao.vendaId, pix: pixRecebimentosMcp.vendaId }

/**
 * A venda, venda de peças ou OS está ligada a algum recebimento (linha de cartão conciliada ou PIX do banco)? Linha
 * estornada no Mercado Pago não conta: o estorno zera o `conciliado` (#51). Para o aviso da edição e a trava da OS.
 */
export async function alvoConciliado(exec: Executor, alvo: Alvo): Promise<boolean> {
  const { cartao, pix } = colunas(alvo)
  const [linhasCartao, linhasPix] = await Promise.all([
    exec.select({ id: conciliacoesCartao.id }).from(conciliacoesCartao).where(and(eq(cartao, alvo.id), eq(conciliacoesCartao.conciliado, true))).limit(1),
    exec.select({ id: pixRecebimentosMcp.id }).from(pixRecebimentosMcp).where(eq(pix, alvo.id)).limit(1),
  ])
  return linhasCartao.length + linhasPix.length > 0
}
