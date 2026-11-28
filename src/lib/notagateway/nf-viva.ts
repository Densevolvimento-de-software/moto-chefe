import { and, eq, notInArray, type SQL } from 'drizzle-orm'
import type { db } from '@/lib/db'
import { notasFiscaisSaida } from '@/lib/db/schema'
import { STATUS_MORTOS } from '@/lib/notagateway/status'

type Executor = Pick<typeof db, 'select'>

/**
 * Predicado de NF de saída de produção viva (ADR-0014): autorizada, em emissão ou em cancelamento, ou seja,
 * produção com status fora de STATUS_MORTOS. A trava da venda e a API de vendas (#323) usam esta peça.
 */
export function condicoesDeNfVivaDeProducao(): SQL[] {
  return [eq(notasFiscaisSaida.ambiente, 'Producao'), notInArray(notasFiscaisSaida.status, STATUS_MORTOS)]
}

/** NF de saída de produção que ainda trava a venda (ADR-0014). */
export async function vendaTemNfViva(tx: Executor, vendaId: string): Promise<boolean> {
  const [viva] = await tx.select({ id: notasFiscaisSaida.id }).from(notasFiscaisSaida)
    .where(and(eq(notasFiscaisSaida.vendaId, vendaId), ...condicoesDeNfVivaDeProducao()))
    .limit(1)
  return !!viva
}
