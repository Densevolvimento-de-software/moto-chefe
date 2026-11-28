// Regra da API de vendas de moto (#323, ADR-0021). Puro: sem banco e sem relógio. Quem chama passa as datas,
// o cursor vindo do navegador e a linha que o banco devolveu.
import { diaValido, hojeBrt } from '@/lib/data-venda'
import { diffDias } from '@/lib/calendario'
import { codificarCursorObjeto, cortarPagina, decodificarCursorObjeto, TAMANHO_DA_PAGINA } from '@/lib/api-leitura-pagina'

export { cortarPagina, TAMANHO_DA_PAGINA }

/** O histórico da API começa em 01/2026 (spec #315). */
export const INICIO_DO_HISTORICO = '2026-01-01'
// Mesmo número que TETO_PERIODO_DIAS do Painel (#901), mas regra separada: este teto é o contrato da API (spec #315).
export const TETO_DIAS_DO_PERIODO = 92

export type Periodo = { de: string; ate: string }
/** Ordem da página: data da venda (até o milissegundo) e número. O número é único (vendas_numero_unique). */
export type Cursor = { d: string; n: number }

/** Só estas colunas saem da venda; o banco pode trazer mais, o mapeamento escolhe. */
export type LinhaVendaMotoBanco = {
  dataVenda: Date; numero: number
  lojaId: string; lojaNome: string
  vendedorId: string; vendedorNome: string
  modelo: string; cor: string; chassi: string; valor: number
  contaAutorizada: boolean; custo: number | null
  cepCliente: string | null; numeroNf: string | null
}

export type VendaMotoDaApi = {
  /** Dia de Brasília, AAAA-MM-DD: o campo é só-dia (ver parseDataInput). */
  data: string; numero: number
  loja: { id: string; nome: string }
  vendedor: { id: string; nome: string }
  modelo: string; cor: string; chassi: string; valor: number
  custo: number | null; cepCliente: string | null; numeroNf: string | null
}

export function periodoDaApi(params: { de?: string | null; ate?: string | null }): Periodo | null {
  const de = params.de ?? undefined
  const ate = params.ate ?? undefined
  if (!diaValido(de) || !diaValido(ate)) return null
  if (de < INICIO_DO_HISTORICO || de > ate) return null
  if (diffDias(de, ate) + 1 > TETO_DIAS_DO_PERIODO) return null
  return { de, ate }
}

// Só os dois campos da ordem. O cursor não é segredo: a data e o número já saem na resposta, e a consulta
// filtra pela Conta e pelo período de qualquer jeito. Um cursor forjado só muda a página dentro do que a chave vê.
export function codificarCursor(c: Cursor): string {
  return codificarCursorObjeto({ d: c.d, n: c.n })
}

const INSTANTE_ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

function decodificarCursor(texto: string): Cursor | null {
  const valor = decodificarCursorObjeto(texto)
  if (valor === null || Object.keys(valor).sort().join(',') !== 'd,n') return null
  const { d, n } = valor
  if (typeof d !== 'string' || !INSTANTE_ISO.test(d)) return null
  const instante = Date.parse(d)
  if (Number.isNaN(instante) || new Date(instante).toISOString() !== d) return null
  if (typeof n !== 'number' || !Number.isSafeInteger(n) || n < 1) return null
  return { d, n }
}

/** Ausência de cursor é a 1ª página. Cursor com formato errado, ou que cai fora do período, não vale. */
export function lerCursor(texto: string | null, periodo: Periodo): { ok: true; cursor: Cursor | null } | { ok: false } {
  if (texto === null) return { ok: true, cursor: null }
  const cursor = decodificarCursor(texto)
  if (cursor === null) return { ok: false }
  const diaDoCursor = hojeBrt(new Date(cursor.d))
  if (diaDoCursor < periodo.de || diaDoCursor > periodo.ate) return { ok: false }
  return { ok: true, cursor }
}

export function cursorDaUltimaLinha(linha: { dataVenda: Date; numero: number }): Cursor {
  return { d: linha.dataVenda.toISOString(), n: linha.numero }
}

/** Custo só sai de Conta autorizada pelo admin_geral (ADR-0021). A consulta aplica a mesma regra em SQL. */
export function custoDaVenda(autorizada: boolean, custo: number | null): number | null {
  return autorizada ? custo : null
}

export function linhaDaVendaMoto(l: LinhaVendaMotoBanco): VendaMotoDaApi {
  return {
    data: hojeBrt(l.dataVenda),
    numero: l.numero,
    loja: { id: l.lojaId, nome: l.lojaNome },
    vendedor: { id: l.vendedorId, nome: l.vendedorNome },
    modelo: l.modelo,
    cor: l.cor,
    chassi: l.chassi,
    valor: l.valor,
    custo: custoDaVenda(l.contaAutorizada, l.custo),
    cepCliente: l.cepCliente,
    numeroNf: l.numeroNf,
  }
}
