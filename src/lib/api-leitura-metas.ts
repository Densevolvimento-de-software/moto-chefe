// Regra da API de metas (#326, ADR-0021). Puro: sem banco e sem relógio. Período em AAAA-MM; o mês é o do
// calendário (a meta é ano e mês, não instante).
import { codificarCursorObjeto, decodificarCursorObjeto } from '@/lib/api-leitura-pagina'
import { INICIO_DO_HISTORICO } from '@/lib/api-leitura-vendas'
import { ultimoDiaDoMes as diasDoMes } from '@/lib/contas-pagar'

/** Um pedido cobre no máximo um ano de meses (padrão do Maestro, #326; a confirmar com o Luis). */
export const LIMITE_MESES_DO_PERIODO = 12

const INICIO_DO_HISTORICO_MES = INICIO_DO_HISTORICO.slice(0, 7)
const MES_RE = /^\d{4}-(0[1-9]|1[0-2])$/
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type PeriodoMeses = { de: string; ate: string }
/** Ordem da página: ano, mês e id da loja. A página seguinte começa depois desta chave. */
export type CursorMeta = { a: number; m: number; l: string }
export type LinhaMetaBanco = { ano: number; mes: number; lojaId: string; lojaNome: string; valorMeta: string }
export type MetaDaApi = { ano: number; mes: number; loja: { id: string; nome: string }; valor: number }

/** Ordem de um mês como número (AAAA*100 + mês): compara períodos e vira chave do cursor. */
export function ordemDoMes(mes: string): number {
  return Number(mes.slice(0, 4)) * 100 + Number(mes.slice(5, 7))
}

/** Quantos meses há de `de` a `ate`, contando os dois extremos. */
function mesesEntre(de: string, ate: string): number {
  const indice = (mes: string) => Number(mes.slice(0, 4)) * 12 + Number(mes.slice(5, 7))
  return indice(ate) - indice(de) + 1
}

export function periodoDeMesesDaApi(params: { de?: string | null; ate?: string | null }): PeriodoMeses | null {
  const { de, ate } = params
  if (!de || !ate || !MES_RE.test(de) || !MES_RE.test(ate)) return null
  if (de < INICIO_DO_HISTORICO_MES || de > ate) return null
  if (mesesEntre(de, ate) > LIMITE_MESES_DO_PERIODO) return null
  return { de, ate }
}

export function cursorDaMeta(linha: { ano: number; mes: number; lojaId: string }): CursorMeta {
  return { a: linha.ano, m: linha.mes, l: linha.lojaId }
}

export function codificarCursorDeMetas(c: CursorMeta): string {
  return codificarCursorObjeto({ a: c.a, m: c.m, l: c.l })
}

/** Ausência de cursor é a 1ª página. Cursor com formato errado, ou de mês fora do período, não vale. */
export function lerCursorDeMetas(
  texto: string | null,
  periodo: PeriodoMeses,
): { ok: true; cursor: CursorMeta | null } | { ok: false } {
  if (texto === null) return { ok: true, cursor: null }
  const valor = decodificarCursorObjeto(texto)
  if (valor === null || Object.keys(valor).sort().join(',') !== 'a,l,m') return { ok: false }
  const { a, m, l } = valor
  if (typeof a !== 'number' || !Number.isSafeInteger(a) || typeof m !== 'number' || !Number.isSafeInteger(m)) return { ok: false }
  if (m < 1 || m > 12 || typeof l !== 'string' || !UUID_RE.test(l)) return { ok: false }
  const mes = `${a}-${String(m).padStart(2, '0')}`
  if (!MES_RE.test(mes) || mes < periodo.de || mes > periodo.ate) return { ok: false }
  return { ok: true, cursor: { a, m, l } }
}

export function linhaDaMeta(l: LinhaMetaBanco): MetaDaApi {
  return { ano: l.ano, mes: l.mes, loja: { id: l.lojaId, nome: l.lojaNome }, valor: Number(l.valorMeta) }
}

/** Último dia do mês AAAA-MM, como AAAA-MM-DD (o registro de acesso e a consulta de despesas usam datas). */
export function ultimoDiaDoMes(mes: string): string {
  return `${mes}-${String(diasDoMes(mes)).padStart(2, '0')}`
}

/** Período no formato que o registro de acesso guarda: primeiro dia do início, último dia do fim. */
export function periodoParaAcesso(periodo: PeriodoMeses): { ini: string; fim: string } {
  return { ini: `${periodo.de}-01`, fim: ultimoDiaDoMes(periodo.ate) }
}
