// Regra da API de despesas (#326, ADR-0021). Puro: sem banco e sem relógio. Uma linha é um mês, uma loja (ou a
// empresa geral do grupo), uma categoria e o total. Lançamento individual não sai.
import { mesBrt } from '@/lib/data-venda'
import { codificarCursorObjeto, decodificarCursorObjeto } from '@/lib/api-leitura-pagina'
import { ordemDeAnoMes, type PeriodoMeses } from '@/lib/api-leitura-metas'

/** Linha como a consulta a monta. O grupo fica só para desempatar a ordem: a resposta não o devolve. */
export type LinhaDespesa = {
  ano: number; mes: number; loja: { id: string; nome: string } | null; grupoId: string; cnpj: string
  grupoDre: string; categoria: string; valor: number
}
export type LinhaDespesaDaApi = {
  ano: number; mes: number; loja: { id: string; nome: string } | null; cnpj: string
  grupoDre: string; categoria: string; valor: number
}
/**
 * Ordem da página: mês; depois loja (t=0) antes da empresa geral (t=1); depois o id da loja ou o id do grupo (k, sempre
 * UUID, para duas empresas gerais com o mesmo CNPJ não se confundirem); depois a categoria.
 */
export type CursorDespesa = { a: number; m: number; t: 0 | 1; k: string; c: string }

const MES_RE = /^\d{4}-(0[1-9]|1[0-2])$/
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Mês de competência como AAAA-MM. Timestamp usa o calendário de Brasília; data pura já é o dia. */
export function mesDaData(data: Date | string): string {
  return typeof data === 'string' ? data.slice(0, 7) : mesBrt(data)
}

type ChaveDaDespesa = { ordem: number; t: 0 | 1; k: string; c: string }

function chaveDaLinha(l: LinhaDespesa): ChaveDaDespesa {
  const ordem = ordemDeAnoMes(l.ano, l.mes)
  return l.loja
    ? { ordem, t: 0, k: l.loja.id, c: l.categoria }
    : { ordem, t: 1, k: l.grupoId, c: l.categoria }
}

function comparar(x: string | number, y: string | number): number {
  return x < y ? -1 : x > y ? 1 : 0
}

function compararChaves(x: ChaveDaDespesa, y: ChaveDaDespesa): number {
  return comparar(x.ordem, y.ordem) || comparar(x.t, y.t) || comparar(x.k, y.k) || comparar(x.c, y.c)
}

/** Ordem estável da página, sem mexer na lista que veio. */
export function ordenarLinhasDespesa(linhas: LinhaDespesa[]): LinhaDespesa[] {
  return [...linhas].sort((a, b) => compararChaves(chaveDaLinha(a), chaveDaLinha(b)))
}

export function cursorDaDespesa(l: LinhaDespesa): CursorDespesa {
  const chave = chaveDaLinha(l)
  return { a: l.ano, m: l.mes, t: chave.t, k: chave.k, c: chave.c }
}

export function codificarCursorDeDespesas(c: CursorDespesa): string {
  return codificarCursorObjeto({ a: c.a, m: c.m, t: c.t, k: c.k, c: c.c })
}

/**
 * Ausência de cursor é a 1ª página. Cada campo é validado pelo tipo dele: a, m são inteiros; t é 0 ou 1; k é UUID
 * (de loja ou de grupo, nunca CNPJ); c é texto não vazio. Mês fora do período não vale.
 */
export function lerCursorDeDespesas(
  texto: string | null,
  periodo: PeriodoMeses,
): { ok: true; cursor: CursorDespesa | null } | { ok: false } {
  if (texto === null) return { ok: true, cursor: null }
  const valor = decodificarCursorObjeto(texto)
  if (valor === null || Object.keys(valor).sort().join(',') !== 'a,c,k,m,t') return { ok: false }
  const { a, m, t, k, c } = valor
  if (typeof a !== 'number' || !Number.isSafeInteger(a) || typeof m !== 'number' || !Number.isSafeInteger(m)) return { ok: false }
  if (t !== 0 && t !== 1) return { ok: false }
  if (typeof k !== 'string' || !UUID_RE.test(k)) return { ok: false }
  if (typeof c !== 'string' || c.length === 0) return { ok: false }
  const mes = `${a}-${String(m).padStart(2, '0')}`
  if (!MES_RE.test(mes) || mes < periodo.de || mes > periodo.ate) return { ok: false }
  return { ok: true, cursor: { a, m, t, k, c } }
}

/** Vale para a página seguinte: a linha vem depois da chave do cursor. */
export function aposCursorDeDespesa(l: LinhaDespesa, cursor: CursorDespesa): boolean {
  const chave = chaveDaLinha(l)
  return compararChaves(chave, { ordem: ordemDeAnoMes(cursor.a, cursor.m), t: cursor.t, k: cursor.k, c: cursor.c }) > 0
}

/** Só estas colunas saem; o valor com duas casas. */
export function linhaDaDespesa(l: LinhaDespesa): LinhaDespesaDaApi {
  return {
    ano: l.ano, mes: l.mes, loja: l.loja, cnpj: l.cnpj, grupoDre: l.grupoDre, categoria: l.categoria,
    valor: Math.round(l.valor * 100) / 100,
  }
}

/** Stub do teste vermelho (#326): ainda não soma a empresa geral por CNPJ. */
export function somarEmpresaGeral(linhas: LinhaDespesa[]): LinhaDespesa[] {
  return linhas
}
