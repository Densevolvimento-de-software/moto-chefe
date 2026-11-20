import { eq } from 'drizzle-orm'
import { db } from './db'
import { configuracaoTaxas } from './db/schema'

/** Custo do PIX do grupo, em fração (0.002 = 0,20%). Grupo sem linha de taxas: 0, como a Precificação. */
export async function custoPixTaxaDoGrupo(grupoId: string): Promise<number> {
  const [linha] = await db.select({ taxa: configuracaoTaxas.custoPixTaxa }).from(configuracaoTaxas)
    .where(eq(configuracaoTaxas.grupoId, grupoId)).limit(1)
  return Number(linha?.taxa ?? 0)
}
