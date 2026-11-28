// Regra da API de despesas (#326, ADR-0021). Puro: sem banco e sem relógio. Uma linha é um mês, uma loja (ou a
// empresa geral do CNPJ), uma categoria e o total. Lançamento individual não sai.
import { mesBrt } from '@/lib/data-venda'
import { codificarCursorObjeto, decodificarCursorObjeto } from '@/lib/api-leitura-pagina'

export type LinhaDespesaDaApi = {
  ano: number; mes: number; loja: { id: string; nome: string } | null; cnpj: string | null
  grupoDre: string; categoria: string; valor: number
}
/** Ordem da página: mês, depois loja (t=0) antes da empresa geral (t=1), depois id da loja ou CNPJ, depois categoria. */
export type CursorDespesa = { a: number; m: number; t: 0 | 1; k: string; c: string }
export type PeriodoDespesas = { de: string; ate: string }

const MES_RE = /^\d{4}-(0[1-9]|1[0-2])$/
const CHAVE_RE = /^[0-9a-f-]{1,64}$/i

/** Mês de competência como AAAA-MM. Timestamp usa o calendário de Brasília; data pura já é o dia. */
export function mesDaData(data: Date | string): string {
  return typeof data === 'string' ? data.slice(0, 7) : mesBrt(data)
}

type ChaveDaDespesa = { ordem: number; t: 0 | 1; k: string; c: string }

function chaveDaLinha(l: LinhaDespesaDaApi): ChaveDaDespesa {
  return l.loja
    ? { ordem: l.ano * 100 + l.mes, t: 0, k: l.loja.id, c: l.categoria }
    : { ordem: l.ano * 100 + l.mes, t: 1, k: l.cnpj ?? '', c: l.categoria }
}

function comparar(x: string | number, y: string | number): number {
  return x < y ? -1 : x > y ? 1 : 0
}

function compararChaves(x: ChaveDaDespesa, y: ChaveDaDespesa): number {
  return comparar(x.ordem, y.ordem) || comparar(x.t, y.t) || comparar(x.k, y.k) || comparar(x.c, y.c)
}

/** Ordem estável da página, sem mexer na lista que veio. */
export function ordenarLinhasDespesa(linhas: LinhaDespesaDaApi[]): LinhaDespesaDaApi[] {
  return [...linhas].sort((a, b) => compararChaves(chaveDaLinha(a), chaveDaLinha(b)))
}

export function cursorDaDespesa(l: LinhaDespesaDaApi): CursorDespesa {
  const chave = chaveDaLinha(l)
  return { a: l.ano, m: l.mes, t: chave.t, k: chave.k, c: chave.c }
}

export function codificarCursorDeDespesas(c: CursorDespesa): string {
  return codificarCursorObjeto({ a: c.a, m: c.m, t: c.t, k: c.k, c: c.c })
}

/** Ausência de cursor é a 1ª página. Cursor com formato errado, ou de mês fora do período, não vale. */
export function lerCursorDeDespesas(
  texto: string | null,
  periodo: PeriodoDespesas,
): { ok: true; cursor: CursorDespesa | null } | { ok: false } {
  if (texto === null) return { ok: true, cursor: null }
  const valor = decodificarCursorObjeto(texto)
  if (valor === null || Object.keys(valor).sort().join(',') !== 'a,c,k,m,t') return { ok: false }
  const { a, m, t, k, c } = valor
  if (typeof a !== 'number' || !Number.isSafeInteger(a) || typeof m !== 'number' || !Number.isSafeInteger(m)) return { ok: false }
  if (t !== 0 && t !== 1) return { ok: false }
  if (typeof k !== 'string' || !CHAVE_RE.test(k)) return { ok: false }
  if (typeof c !== 'string' || c.length === 0) return { ok: false }
  const mes = `${a}-${String(m).padStart(2, '0')}`
  if (!MES_RE.test(mes) || mes < periodo.de || mes > periodo.ate) return { ok: false }
  return { ok: true, cursor: { a, m, t, k, c } }
}

/** Vale para a página seguinte: a linha vem depois da chave do cursor. */
export function aposCursorDeDespesa(l: LinhaDespesaDaApi, cursor: CursorDespesa): boolean {
  const chave = chaveDaLinha(l)
  return compararChaves(chave, { ordem: cursor.a * 100 + cursor.m, t: cursor.t, k: cursor.k, c: cursor.c }) > 0
}

/** Só estas colunas saem; o valor com duas casas. */
export function linhaDaDespesa(l: LinhaDespesaDaApi): LinhaDespesaDaApi {
  return {
    ano: l.ano, mes: l.mes, loja: l.loja, cnpj: l.cnpj, grupoDre: l.grupoDre, categoria: l.categoria,
    valor: Math.round(l.valor * 100) / 100,
  }
}
