// Lançamentos do caixa das lojas, lidos pelo /caixa e pela aba de despesas (saídas de caixa).
// Nome de quem lançou e de quem aprovou pela regra de nomesDeUsuariosVisiveis; fora dela, nulo, e a
// linha continua na lista e nos totais (#132).
import { and, desc, eq, gte, inArray, lte, ne } from 'drizzle-orm'
import { db } from '@/lib/db'
import { lancamentosCaixa, lojas } from '@/lib/db/schema'
import { nomesDeUsuariosVisiveis } from '@/lib/conta'
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

export async function lancamentosCaixaDoPeriodo(grupo: GrupoDoRegistro, f: FiltroCaixa, exec: Executor = db) {
  const linhas = await exec
    .select({
      id: lancamentosCaixa.id,
      tipo: lancamentosCaixa.tipo,
      lojaId: lancamentosCaixa.lojaId,
      lojaNome: lojas.nome,
      categoria: lancamentosCaixa.categoria,
      descricao: lancamentosCaixa.descricao,
      valor: lancamentosCaixa.valor,
      data: lancamentosCaixa.data,
      usuarioId: lancamentosCaixa.usuarioId,
      comprovanteUrl: lancamentosCaixa.comprovanteUrl,
      statusAprovacao: lancamentosCaixa.statusAprovacao,
      aprovadoPorId: lancamentosCaixa.aprovadoPorId,
      aprovadoEm: lancamentosCaixa.aprovadoEm,
      criadoEm: lancamentosCaixa.criadoEm,
    })
    .from(lancamentosCaixa)
    .innerJoin(lojas, eq(lancamentosCaixa.lojaId, lojas.id))
    .where(and(
      inArray(lancamentosCaixa.lojaId, f.lojaIds),
      f.lojaId ? eq(lancamentosCaixa.lojaId, f.lojaId) : undefined,
      gte(lancamentosCaixa.data, f.inicio),
      lte(lancamentosCaixa.data, f.fim),
      f.tipo ? eq(lancamentosCaixa.tipo, f.tipo) : undefined,
      f.semReprovados ? ne(lancamentosCaixa.statusAprovacao, 'reprovado') : undefined,
    ))
    .orderBy(desc(lancamentosCaixa.data), desc(lancamentosCaixa.criadoEm))
  const ids = linhas.flatMap(l => l.aprovadoPorId ? [l.usuarioId, l.aprovadoPorId] : [l.usuarioId])
  const nomes = await nomesDeUsuariosVisiveis(grupo, ids, exec)
  return linhas.map(({ usuarioId, aprovadoPorId, ...l }) => ({
    ...l,
    usuarioNome: nomes.get(usuarioId) ?? null,
    aprovadoPorNome: aprovadoPorId ? nomes.get(aprovadoPorId) ?? null : null,
  }))
}
