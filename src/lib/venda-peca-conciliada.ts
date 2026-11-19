import { and, eq } from 'drizzle-orm'
import type { db } from '@/lib/db'
import { conciliacoesCartao, pixRecebimentosMcp } from '@/lib/db/schema'
import { cartaoNaoEstornado } from '@/lib/cartao-status'

type Executor = Pick<typeof db, 'select'>

/**
 * A venda de peças está ligada a algum recebimento (linha de cartão ou PIX do banco)? Linha estornada no Mercado Pago
 * não conta: o dinheiro voltou ao cliente (#51). Para o aviso da edição da venda.
 */
export async function vendaPecaConciliada(exec: Executor, vendaId: string): Promise<boolean> {
  const [cartao, pix] = await Promise.all([
    exec.select({ id: conciliacoesCartao.id }).from(conciliacoesCartao).where(and(eq(conciliacoesCartao.pecaVendaId, vendaId), cartaoNaoEstornado)).limit(1),
    exec.select({ id: pixRecebimentosMcp.id }).from(pixRecebimentosMcp).where(eq(pixRecebimentosMcp.pecaVendaId, vendaId)).limit(1),
  ])
  return cartao.length + pix.length > 0
}
