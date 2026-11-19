// Rótulos das saídas do banco (Open Finance) na aba de /despesas: loja, a quem se destinou a despesa
// lançada e quem lançou.
import { inArray } from 'drizzle-orm'
import { db } from '@/lib/db'
import { despesas, lojas, usuarios } from '@/lib/db/schema'
import { porId, seHouver, type GrupoDoRegistro } from '@/lib/rotulos-alvo'

type Executor = Pick<typeof db, 'select'>

export type IdsDasSaidas = { lojaIds: string[]; despesaIds: string[]; lancadoPorIds: string[] }

export async function rotulosDasSaidas(_grupo: GrupoDoRegistro, ids: IdsDasSaidas, exec: Executor = db) {
  const [lojasDb, despesasDb, usuariosDb] = await Promise.all([
    seHouver(ids.lojaIds, x => exec.select({ id: lojas.id, nome: lojas.nome }).from(lojas).where(inArray(lojas.id, x))),
    seHouver(ids.despesaIds, x => exec.select({ id: despesas.id, beneficiario: despesas.beneficiario }).from(despesas)
      .where(inArray(despesas.id, x))),
    seHouver(ids.lancadoPorIds, x => exec.select({ id: usuarios.id, nome: usuarios.nome }).from(usuarios).where(inArray(usuarios.id, x))),
  ])
  return {
    lojaNome: porId(lojasDb, l => l.nome),
    beneficiario: porId(despesasDb, d => d.beneficiario),
    lancadoPorNome: porId(usuariosDb, u => u.nome),
  }
}
