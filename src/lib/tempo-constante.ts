import { timingSafeEqual } from 'node:crypto'

/**
 * Compara um segredo recebido com o esperado sem vazar, pelo tempo de resposta, quantos
 * caracteres bateram. O tamanho é comparado em bytes antes: o timingSafeEqual lança com
 * tamanhos diferentes.
 */
export function iguaisEmTempoConstante(recebido: string, esperado: string): boolean {
  const a = Buffer.from(recebido)
  const b = Buffer.from(esperado)
  return a.length === b.length && timingSafeEqual(a, b)
}
