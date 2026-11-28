// Consulta da API de ordens de serviço (#325, ADR-0021). Lê várias Contas de propósito, sem sessão: o filtro de loja
// (lojasQueSaem, o mesmo de /lojas e de vendas) fica dentro da consulta. As colunas saem só pela lista explícita
// abaixo e pelo mapeamento puro em @/lib/api-leitura-os. Itens são lidos só das OS da página.
import { and, asc, eq, gte, inArray, lt, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { db } from '@/lib/db'
import { lojas, motos, ordensServico, osItens, usuarios } from '@/lib/db/schema'
import { inicioDoDiaBrt } from '@/lib/data-venda'
import { addDias } from '@/lib/calendario'
import { cortarPagina, TAMANHO_DA_PAGINA } from '@/lib/api-leitura-pagina'
import type { Periodo } from '@/lib/api-leitura-vendas'
import { lojasQueSaem } from '@/lib/queries/api-leitura'
import {
  codificarCursorDaOS, cursorDaUltimaOS, montarOSDaApi, TIPO_DO_ITEM,
  type Cursor, type ItemOSBanco, type LinhaOSBanco, type OSDaApi,
} from '@/lib/api-leitura-os'

// Data de abertura até o milissegundo: a ordem usa este valor e o cursor leva o mesmo (ver #323).
const dataDaOrdem = sql<Date>`date_trunc('milliseconds', ${ordensServico.dataAbertura})`
const TIPOS_DA_API = Object.keys(TIPO_DO_ITEM)

/** Itens das OS da página, nas OS que a API mostra. O valor da linha é calculado no banco, com numeric exato. */
async function itensDaPagina(osIds: string[]): Promise<ItemOSBanco[]> {
  if (osIds.length === 0) return []
  return db
    .select({
      osId: osItens.osId,
      tipo: osItens.tipo,
      quantidade: sql<number>`${osItens.quantidade}::float8`,
      valorUnitario: sql<number>`${osItens.valorUnitario}::float8`,
      valor: sql<number>`round(${osItens.quantidade} * ${osItens.valorUnitario}, 2)::float8`,
    })
    .from(osItens)
    .where(and(inArray(osItens.osId, osIds), inArray(osItens.tipo, TIPOS_DA_API)))
    .orderBy(asc(osItens.criadoEm), asc(osItens.id))
}

/** Uma página de OS das lojas que saem, com data de abertura no período (dias de Brasília), depois do cursor. */
export async function listarOSDaApi(
  periodo: Periodo,
  cursor: Cursor | null,
): Promise<{ ordens: OSDaApi[]; proximaPagina: string | null }> {
  const mecanico = alias(usuarios, 'mecanico')
  const depoisDoCursor = cursor
    ? sql`(${dataDaOrdem}, ${ordensServico.id}) > (${cursor.d}::timestamptz, ${cursor.i}::uuid)`
    : undefined
  const linhas: LinhaOSBanco[] = await db
    .select({
      id: ordensServico.id,
      numero: ordensServico.numero,
      status: ordensServico.status,
      dataAbertura: ordensServico.dataAbertura,
      dataConclusao: ordensServico.dataConclusao,
      lojaId: lojas.id,
      lojaNome: lojas.nome,
      tecnicoId: mecanico.id,
      tecnicoNome: mecanico.nome,
      motoId: ordensServico.motoId,
      chassiMoto: motos.chassi,
      chassiOs: ordensServico.chassiOs,
      marcaExterna: ordensServico.marcaExterna,
      modeloExterno: ordensServico.modeloExterno,
      valorTotal: sql<number | null>`${ordensServico.valorTotal}::float8`,
    })
    .from(ordensServico)
    .innerJoin(lojas, eq(ordensServico.lojaId, lojas.id))
    .leftJoin(motos, eq(ordensServico.motoId, motos.id))
    .leftJoin(mecanico, eq(ordensServico.mecanicoId, mecanico.id))
    .where(and(
      inArray(ordensServico.lojaId, lojasQueSaem()),
      gte(ordensServico.dataAbertura, inicioDoDiaBrt(periodo.de)),
      // Até o último instante do dia: menor que o início do dia seguinte, sem perder microssegundo.
      lt(ordensServico.dataAbertura, inicioDoDiaBrt(addDias(periodo.ate, 1))),
      depoisDoCursor,
    ))
    .orderBy(asc(dataDaOrdem), asc(ordensServico.id))
    .limit(TAMANHO_DA_PAGINA + 1)

  const pagina = cortarPagina(linhas)
  const itens = await itensDaPagina(pagina.linhas.map(l => l.id))
  const ultima = pagina.linhas[pagina.linhas.length - 1]
  return {
    ordens: montarOSDaApi(pagina.linhas, itens),
    proximaPagina: pagina.temMais && ultima ? codificarCursorDaOS(cursorDaUltimaOS(ultima)) : null,
  }
}
