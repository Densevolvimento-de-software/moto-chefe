// Despesas lançadas à mão em /despesas (as que nasceram de uma saída do banco ficam na aba própria).
// Loja só do grupo e nome de quem lançou pela regra de nomesDeUsuariosVisiveis; fora disso, nulo, e a
// linha continua na lista e nos totais (#132).
import { and, desc, eq, gte, lte, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { despesas, despesasOpenFinance, lojas } from '@/lib/db/schema'
import { nomesDeUsuariosVisiveis } from '@/lib/conta'
import type { GrupoDoRegistro } from '@/lib/rotulos-alvo'

type Executor = Pick<typeof db, 'select'>

/** Datas 'YYYY-MM-DD'. */
export async function despesasManuaisDoPeriodo(grupo: GrupoDoRegistro, { inicio, fim }: { inicio: string; fim: string }, exec: Executor = db) {
  const linhas = await exec
    .select({
      id:             despesas.id,
      lojaId:         despesas.lojaId,
      lojaNome:       lojas.nome,
      categoria:      despesas.categoria,
      beneficiario:   despesas.beneficiario,
      descricao:      despesas.descricao,
      valor:          despesas.valor,
      data:           despesas.data,
      formaPagamento: despesas.formaPagamento,
      banco:          despesas.banco,
      usuarioId:      despesas.usuarioId,
    })
    .from(despesas)
    .leftJoin(lojas, and(eq(despesas.lojaId, lojas.id), eq(lojas.grupoId, grupo.id)))
    .where(and(
      eq(despesas.grupoId, grupo.id),
      gte(despesas.data, inicio),
      lte(despesas.data, fim),
      // Só as lançadas à mão. A que nasceu de uma saída do banco vive na aba
      // "Importar do Banco" — antes aparecia nas duas e dava impressão de dobra.
      sql`NOT EXISTS (SELECT 1 FROM ${despesasOpenFinance} o WHERE o.despesa_id = ${despesas.id})`,
    ))
    .orderBy(desc(despesas.data), desc(despesas.criadoEm))
  const nomes = await nomesDeUsuariosVisiveis(grupo, linhas.map(l => l.usuarioId), exec)
  return linhas.map(({ usuarioId, ...l }) => ({ ...l, usuarioNome: nomes.get(usuarioId) ?? null }))
}
