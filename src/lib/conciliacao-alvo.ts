// Alvo da conciliação: a venda de moto, a venda de peça ou a OS cujos pagamentos se conciliam.
// Vem do navegador nas Server Actions; tipo fora da lista ou id que não é uuid vale como inexistente.
import { ehUuid } from './uuid'

export const ALVO_TIPOS = ['moto', 'peca', 'os'] as const
export type AlvoTipo = typeof ALVO_TIPOS[number]
export type AlvoConciliacao = { tipo: AlvoTipo; id: string }

/** Colunas de vínculo de uma linha de cartão com o alvo (no máximo uma preenchida). */
export type Alvos = { vendaId: string | null; pecaVendaId: string | null; osId: string | null }
export const semAlvos = (): Alvos => ({ vendaId: null, pecaVendaId: null, osId: null })

/** "PA" (venda de peça) ou "OS" antes do número; venda de moto não tem. */
export const siglaDoAlvo = (tipo?: AlvoTipo): 'PA' | 'OS' | null => (tipo === 'peca' ? 'PA' : tipo === 'os' ? 'OS' : null)

export const ehAlvoTipo = (x: unknown): x is AlvoTipo => (ALVO_TIPOS as readonly unknown[]).includes(x)

export function alvoValido(alvo: unknown): alvo is AlvoConciliacao {
  if (typeof alvo !== 'object' || alvo === null) return false
  const { tipo, id } = alvo as Record<string, unknown>
  return ehAlvoTipo(tipo) && typeof id === 'string' && ehUuid(id)
}

/** Tipo para a frase de "não encontrado" de um alvo inválido: o da lista, ou o da venda de moto. */
export function tipoDoAlvo(alvo: unknown): AlvoTipo {
  const tipo = typeof alvo === 'object' && alvo !== null ? (alvo as Record<string, unknown>).tipo : undefined
  return ehAlvoTipo(tipo) ? tipo : 'moto'
}

const COLUNA_DO_TIPO: Record<AlvoTipo, keyof Alvos> = { moto: 'vendaId', peca: 'pecaVendaId', os: 'osId' }

/** O alvo das colunas de vínculo (a primeira preenchida, na ordem dos tipos); null se nenhuma. */
export function alvoDasColunas(a: Alvos): AlvoConciliacao | null {
  const tipo = ALVO_TIPOS.find(t => a[COLUNA_DO_TIPO[t]])
  return tipo ? { tipo, id: a[COLUNA_DO_TIPO[tipo]]! } : null
}

/** Colunas do vínculo de uma linha de cartão: a do tipo do alvo com o id, as outras nulas. */
export const colunasDoAlvo = ({ tipo, id }: AlvoConciliacao): Alvos => ({ ...semAlvos(), [COLUNA_DO_TIPO[tipo]]: id })
