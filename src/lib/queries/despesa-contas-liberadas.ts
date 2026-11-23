import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { openFinanceContasDespesa } from '@/lib/db/schema'
import type { ContaLiberadaDespesa } from '@/lib/despesa-contas-liberadas'

type Executor = Pick<typeof db, 'select'>

/** Bancos do mcp.ai cujas saídas viram despesa neste grupo. Só as linhas do grupo pedido (isolamento entre Contas). */
export async function contasLiberadasDespesa(grupoId: string, exec: Executor = db): Promise<ContaLiberadaDespesa[]> {
  return exec.select({ banco: openFinanceContasDespesa.banco, inicioEm: openFinanceContasDespesa.inicioEm })
    .from(openFinanceContasDespesa)
    .where(eq(openFinanceContasDespesa.grupoId, grupoId))
}
