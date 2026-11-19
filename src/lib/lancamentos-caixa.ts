// Lançamentos do caixa das lojas, lidos pelo /caixa e pela aba de despesas (saídas de caixa).
import { and, desc, eq, gte, inArray, lte, ne } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { db } from '@/lib/db'
import { lancamentosCaixa, lojas, usuarios } from '@/lib/db/schema'
import type { GrupoDoRegistro } from '@/lib/rotulos-alvo'

type Executor = Pick<typeof db, 'select'>

/** `lojaIds`: as lojas que quem consulta pode ver; `lojaId` restringe a uma delas. Datas 'YYYY-MM-DD'. */
export type FiltroCaixa = {
  lojaIds: string[]
  inicio: string
  fim: string
  lojaId?: string | null
  tipo?: 'entrada' | 'saida'
  semReprovados?: boolean
}

export async function lancamentosCaixaDoPeriodo(_grupo: GrupoDoRegistro, f: FiltroCaixa, exec: Executor = db) {
  const aprovadores = alias(usuarios, 'aprovadores')
  return exec
    .select({
      id: lancamentosCaixa.id,
      tipo: lancamentosCaixa.tipo,
      lojaId: lancamentosCaixa.lojaId,
      lojaNome: lojas.nome,
      categoria: lancamentosCaixa.categoria,
      descricao: lancamentosCaixa.descricao,
      valor: lancamentosCaixa.valor,
      data: lancamentosCaixa.data,
      usuarioNome: usuarios.nome,
      comprovanteUrl: lancamentosCaixa.comprovanteUrl,
      statusAprovacao: lancamentosCaixa.statusAprovacao,
      aprovadoPorNome: aprovadores.nome,
      aprovadoEm: lancamentosCaixa.aprovadoEm,
      criadoEm: lancamentosCaixa.criadoEm,
    })
    .from(lancamentosCaixa)
    .innerJoin(lojas, eq(lancamentosCaixa.lojaId, lojas.id))
    .innerJoin(usuarios, eq(lancamentosCaixa.usuarioId, usuarios.id))
    .leftJoin(aprovadores, eq(lancamentosCaixa.aprovadoPorId, aprovadores.id))
    .where(and(
      inArray(lancamentosCaixa.lojaId, f.lojaIds),
      f.lojaId ? eq(lancamentosCaixa.lojaId, f.lojaId) : undefined,
      gte(lancamentosCaixa.data, f.inicio),
      lte(lancamentosCaixa.data, f.fim),
      f.tipo ? eq(lancamentosCaixa.tipo, f.tipo) : undefined,
      f.semReprovados ? ne(lancamentosCaixa.statusAprovacao, 'reprovado') : undefined,
    ))
    .orderBy(desc(lancamentosCaixa.data), desc(lancamentosCaixa.criadoEm))
}
