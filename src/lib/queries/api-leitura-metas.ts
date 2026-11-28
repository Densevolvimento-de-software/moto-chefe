// Consulta da API de metas (#326, ADR-0021). Lê várias Contas de propósito, sem sessão: as lojas que saem e a
// Conta autorizada ficam dentro da consulta (lojasQueSaem e contaAutorizada). As colunas saem só pelo mapeamento
// puro em @/lib/api-leitura-metas.
import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { contas, grupos, lojas, metasLoja } from '@/lib/db/schema'
import { cortarPagina, TAMANHO_DA_PAGINA } from '@/lib/api-leitura-pagina'
import {
  codificarCursorDeMetas, cursorDaMeta, linhaDaMeta, ordemDeAnoMes, ordemDoMes, type CursorMeta, type MetaDaApi, type PeriodoMeses,
} from '@/lib/api-leitura-metas'
import { contaAutorizada, lojasQueSaem } from '@/lib/queries/api-leitura'

/** Metas das lojas que saem, de Conta autorizada, no período, depois do cursor. Ordem: ano, mês e id da loja. */
export async function listarMetasDaApi(
  periodo: PeriodoMeses,
  cursor: CursorMeta | null,
): Promise<{ metas: MetaDaApi[]; proximaPagina: string | null }> {
  const depoisDoCursor = cursor
    ? sql`(${metasLoja.ano} * 100 + ${metasLoja.mes}, ${lojas.id}) > (${ordemDeAnoMes(cursor.a, cursor.m)}::int, ${cursor.l}::uuid)`
    : undefined
  const linhas = await db
    .select({
      ano: metasLoja.ano,
      mes: metasLoja.mes,
      lojaId: lojas.id,
      lojaNome: lojas.nome,
      valorMeta: metasLoja.valorMeta,
    })
    .from(metasLoja)
    .innerJoin(lojas, eq(metasLoja.lojaId, lojas.id))
    .innerJoin(grupos, eq(lojas.grupoId, grupos.id))
    .innerJoin(contas, eq(grupos.contaId, contas.id))
    .where(and(
      inArray(lojas.id, lojasQueSaem()),
      contaAutorizada(),
      sql`(${metasLoja.ano} * 100 + ${metasLoja.mes}) between ${ordemDoMes(periodo.de)} and ${ordemDoMes(periodo.ate)}`,
      depoisDoCursor,
    ))
    .orderBy(asc(metasLoja.ano), asc(metasLoja.mes), asc(lojas.id))
    .limit(TAMANHO_DA_PAGINA + 1)

  const pagina = cortarPagina(linhas)
  const ultima = pagina.linhas[pagina.linhas.length - 1]
  return {
    metas: pagina.linhas.map(linhaDaMeta),
    proximaPagina: pagina.temMais && ultima ? codificarCursorDeMetas(cursorDaMeta(ultima)) : null,
  }
}
