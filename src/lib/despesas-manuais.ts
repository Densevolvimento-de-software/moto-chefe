// Despesas lançadas à mão em /despesas (as que nasceram de uma saída do banco ficam na aba própria).
import { and, desc, eq, gte, lte, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { despesas, despesasOpenFinance, lojas, usuarios } from '@/lib/db/schema'
import type { GrupoDoRegistro } from '@/lib/rotulos-alvo'

type Executor = Pick<typeof db, 'select'>

/** Datas 'YYYY-MM-DD'. */
export async function despesasManuaisDoPeriodo(grupo: GrupoDoRegistro, { inicio, fim }: { inicio: string; fim: string }, exec: Executor = db) {
  return exec
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
      usuarioNome:    usuarios.nome,
    })
    .from(despesas)
    .leftJoin(lojas,    eq(despesas.lojaId,    lojas.id))
    .innerJoin(usuarios, eq(despesas.usuarioId, usuarios.id))
    .where(and(
      eq(despesas.grupoId, grupo.id),
      gte(despesas.data, inicio),
      lte(despesas.data, fim),
      // Só as lançadas à mão. A que nasceu de uma saída do banco vive na aba
      // "Importar do Banco" — antes aparecia nas duas e dava impressão de dobra.
      sql`NOT EXISTS (SELECT 1 FROM ${despesasOpenFinance} o WHERE o.despesa_id = ${despesas.id})`,
    ))
    .orderBy(desc(despesas.data), desc(despesas.criadoEm))
}
