// Alvo da conciliação: a venda de moto, a venda de peça ou a OS cujos pagamentos se conciliam.
// Vem do navegador nas Server Actions; tipo fora da lista ou id que não é uuid vale como inexistente.
import { ehUuid } from './uuid'

export const ALVO_TIPOS = ['moto', 'peca', 'os'] as const
export type AlvoTipo = typeof ALVO_TIPOS[number]
export type AlvoConciliacao = { tipo: AlvoTipo; id: string }

export function alvoValido(alvo: unknown): alvo is AlvoConciliacao {
  if (typeof alvo !== 'object' || alvo === null) return false
  const { tipo, id } = alvo as Record<string, unknown>
  return (ALVO_TIPOS as readonly unknown[]).includes(tipo) && typeof id === 'string' && ehUuid(id)
}
