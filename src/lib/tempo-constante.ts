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

const PREFIXO_BEARER = 'Bearer '

/** Token do `Authorization: Bearer <token>`: `null` sem header ou sem o prefixo; `''` com o prefixo e nada depois. */
export function tokenDoBearer(authorization: string | null): string | null {
  if (authorization === null || !authorization.startsWith(PREFIXO_BEARER)) return null
  return authorization.slice(PREFIXO_BEARER.length)
}

/** `Authorization: Bearer <segredo>` com o segredo esperado, comparado em tempo constante. */
export function bearerConfere(authorization: string | null, esperado: string): boolean {
  const token = tokenDoBearer(authorization)
  return token !== null && iguaisEmTempoConstante(token, esperado)
}
