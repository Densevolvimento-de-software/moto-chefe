import { and, eq, inArray, notInArray } from 'drizzle-orm'
import type { db } from '@/lib/db'
import { notasFiscaisSaida } from '@/lib/db/schema'
import { STATUS_MORTOS } from '@/lib/notagateway/status'

type Executor = Pick<typeof db, 'select'>

/** NF de saída de produção que ainda trava a venda (ADR-0014): autorizada, em emissão ou em cancelamento. */
export async function vendaTemNfViva(tx: Executor, vendaId: string): Promise<boolean> {
  const [viva] = await tx.select({ id: notasFiscaisSaida.id }).from(notasFiscaisSaida)
    .where(and(eq(notasFiscaisSaida.vendaId, vendaId), eq(notasFiscaisSaida.ambiente, 'Producao'), notInArray(notasFiscaisSaida.status, STATUS_MORTOS)))
    .limit(1)
  return !!viva
}

/** As notas da venda com o que a trava do "Cancelar venda" e do Alterar a Entrega leem (`status.ts`). */
export async function notasParaTravaDaVenda(tx: Executor, vendaId: string) {
  return notasParaTravaDasVendas(tx, [vendaId])
}

/** O mesmo, das vendas de um pedido numa consulta (#23), com a venda e o número de cada nota. */
export async function notasParaTravaDasVendas(tx: Executor, vendaIds: readonly string[]) {
  const notas = await tx.select({
    vendaId: notasFiscaisSaida.vendaId, numero: notasFiscaisSaida.numero,
    ambiente: notasFiscaisSaida.ambiente, status: notasFiscaisSaida.status, dataAutorizacao: notasFiscaisSaida.dataAutorizacao,
  }).from(notasFiscaisSaida).where(inArray(notasFiscaisSaida.vendaId, [...vendaIds]))
  return notas.map(n => ({ ...n, dataAutorizacao: n.dataAutorizacao?.toISOString() ?? null }))
}
