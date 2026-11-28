// Consulta da API de despesas (#326, ADR-0021). Lê várias Contas de propósito, sem sessão. As lojas que saem e a Conta
// autorizada ficam dentro da consulta (lojasQueSaem e contaAutorizada). A soma é a mesma do DRE (fontesDespesaDoPeriodo
// e somarDespesas), com soLojas: só as lojas que saem e a empresa geral entram.
import { and, asc, eq, inArray } from 'drizzle-orm'
import { db } from '@/lib/db'
import { contas, grupos, lojas } from '@/lib/db/schema'
import { addDias } from '@/lib/calendario'
import { inicioDoDiaBrt } from '@/lib/data-venda'
import { chaveCategoria, somarDespesas, soDigitos } from '@/lib/despesas-operacionais'
import { cortarPagina } from '@/lib/api-leitura-pagina'
import { ultimoDiaDoMes } from '@/lib/api-leitura-metas'
import {
  aposCursorDeDespesa, codificarCursorDeDespesas, cursorDaDespesa, linhaDaDespesa, mesDaData, ordenarLinhasDespesa,
  type CursorDespesa, type LinhaDespesa, type LinhaDespesaDaApi,
} from '@/lib/api-leitura-despesas'
import type { PeriodoMeses } from '@/lib/api-leitura-metas'
import { contaAutorizada, lojasQueSaem } from '@/lib/queries/api-leitura'
import { fontesDespesaDoPeriodo, mapaGrupoPorCategoria } from '@/lib/queries/dre'

type GrupoQueSai = { grupoId: string; cnpj: string; lojas: { id: string; nome: string }[] }

/** Grupos com ao menos uma loja que sai, de Conta autorizada. A empresa geral deles sai por CNPJ. */
async function gruposQueSaem(): Promise<GrupoQueSai[]> {
  const linhas = await db
    .select({ grupoId: grupos.id, cnpj: grupos.cnpj, lojaId: lojas.id, lojaNome: lojas.nome })
    .from(lojas)
    .innerJoin(grupos, eq(lojas.grupoId, grupos.id))
    .innerJoin(contas, eq(grupos.contaId, contas.id))
    .where(and(inArray(lojas.id, lojasQueSaem()), contaAutorizada()))
    .orderBy(asc(grupos.id), asc(lojas.id))
  const porGrupo = new Map<string, GrupoQueSai>()
  for (const l of linhas) {
    const atual = porGrupo.get(l.grupoId) ?? { grupoId: l.grupoId, cnpj: l.cnpj, lojas: [] }
    porGrupo.set(l.grupoId, { ...atual, lojas: [...atual.lojas, { id: l.lojaId, nome: l.lojaNome }] })
  }
  return [...porGrupo.values()]
}

/** Linhas de um grupo no período, mês a mês. Cada saída cai num balde só: a loja, ou a empresa geral (loja nula). */
async function linhasDoGrupo(grupo: GrupoQueSai, inicio: Date, fim: Date): Promise<LinhaDespesa[]> {
  const nomeDaLoja = new Map(grupo.lojas.map(l => [l.id, l.nome]))
  const { config, banco, manuais, caixa } = await fontesDespesaDoPeriodo(
    grupo.grupoId, grupo.lojas.map(l => l.id), inicio, fim, { soLojas: true },
  )
  const grupoDoDre = await mapaGrupoPorCategoria(grupo.grupoId)
  const doMes = <T extends { data: Date | string }>(itens: T[], mes: string) => itens.filter(i => mesDaData(i.data) === mes)
  const meses = [...new Set([...banco, ...manuais, ...caixa].map(i => mesDaData(i.data)))]
  return meses.flatMap(mes => {
    const [ano, numeroDoMes] = mes.split('-').map(Number)
    const total = somarDespesas(doMes(banco, mes), doMes(manuais, mes), config, doMes(caixa, mes))
    const grupoDre = (categoria: string) => grupoDoDre.get(chaveCategoria(categoria)) ?? 'outras'
    const cnpj = soDigitos(grupo.cnpj)
    const porLoja = [...total.porCategoriaPorLoja].flatMap(([lojaId, categorias]) => categorias.map(c => ({
      ano, mes: numeroDoMes, loja: { id: lojaId, nome: nomeDaLoja.get(lojaId) ?? '' }, grupoId: grupo.grupoId, cnpj,
      grupoDre: grupoDre(c.categoria), categoria: c.categoria, valor: c.total,
    })))
    const geral = total.porCategoriaGeral.map(c => ({
      ano, mes: numeroDoMes, loja: null, grupoId: grupo.grupoId, cnpj,
      grupoDre: grupoDre(c.categoria), categoria: c.categoria, valor: c.total,
    }))
    return [...porLoja, ...geral]
  })
}

/** Uma página das despesas do período, depois do cursor, na ordem estável de ordenarLinhasDespesa. */
export async function listarDespesasDaApi(
  periodo: PeriodoMeses,
  cursor: CursorDespesa | null,
): Promise<{ despesas: LinhaDespesaDaApi[]; proximaPagina: string | null }> {
  // Dia 1 do mês inicial até o dia 1 do mês seguinte ao final, em Brasília (03:00 UTC é meia-noite de Brasília).
  const inicio = inicioDoDiaBrt(`${periodo.de}-01`)
  const fim = inicioDoDiaBrt(addDias(ultimoDiaDoMes(periodo.ate), 1))
  // Um grupo por vez: as consultas do DRE já mostraram que rodar tudo junto derruba o pool.
  const linhas: LinhaDespesa[] = []
  for (const grupo of await gruposQueSaem()) {
    linhas.push(...await linhasDoGrupo(grupo, inicio, fim))
  }
  const ordenadas = ordenarLinhasDespesa(linhas)
  const depois = cursor ? ordenadas.filter(l => aposCursorDeDespesa(l, cursor)) : ordenadas
  const pagina = cortarPagina(depois)
  const ultima = pagina.linhas[pagina.linhas.length - 1]
  return {
    despesas: pagina.linhas.map(linhaDaDespesa),
    proximaPagina: pagina.temMais && ultima ? codificarCursorDeDespesas(cursorDaDespesa(ultima)) : null,
  }
}
