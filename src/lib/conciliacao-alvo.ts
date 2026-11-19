// Alvo da conciliação: a venda de moto, a venda de peça ou a OS cujos pagamentos se conciliam.
// Vem do navegador nas Server Actions; tipo fora da lista ou id que não é uuid vale como inexistente.
import { ehUuid } from './uuid'

export const ALVO_TIPOS = ['moto', 'peca', 'os'] as const
export type AlvoTipo = typeof ALVO_TIPOS[number]
export type AlvoConciliacao = { tipo: AlvoTipo; id: string }

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
