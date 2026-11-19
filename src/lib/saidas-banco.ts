// Rótulos das saídas do banco (Open Finance) na aba de /despesas: loja, a quem se destinou a despesa
// lançada e quem lançou. Loja e despesa só do grupo da saída (o lançamento só aceita o grupo ativo);
// quem lançou pela regra de nomesDeUsuariosVisiveis. O resto sai como id inexistente (#132).
import { and, eq, inArray } from 'drizzle-orm'
import { db } from '@/lib/db'
import { despesas, lojas } from '@/lib/db/schema'
import { nomesDeUsuariosVisiveis } from '@/lib/conta'
import { porId, seHouver, type GrupoDoRegistro } from '@/lib/rotulos-alvo'

type Executor = Pick<typeof db, 'select'>

export type IdsDasSaidas = { lojaIds: string[]; despesaIds: string[]; lancadoPorIds: string[] }

export async function rotulosDasSaidas(grupo: GrupoDoRegistro, ids: IdsDasSaidas, exec: Executor = db) {
  const [lojasDb, despesasDb, lancadoPorNome] = await Promise.all([
    seHouver(ids.lojaIds, x => exec.select({ id: lojas.id, nome: lojas.nome }).from(lojas)
      .where(and(inArray(lojas.id, x), eq(lojas.grupoId, grupo.id)))),
    seHouver(ids.despesaIds, x => exec.select({ id: despesas.id, beneficiario: despesas.beneficiario }).from(despesas)
      .where(and(inArray(despesas.id, x), eq(despesas.grupoId, grupo.id)))),
    nomesDeUsuariosVisiveis(grupo, ids.lancadoPorIds, exec),
  ])
  return {
    lojaNome: porId(lojasDb, l => l.nome),
    beneficiario: porId(despesasDb, d => d.beneficiario),
    lancadoPorNome,
  }
}
