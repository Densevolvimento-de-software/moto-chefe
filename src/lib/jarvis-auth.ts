import { iguaisEmTempoConstante } from '@/lib/tempo-constante'

/** Confere o header Authorization contra JARVIS_API_TOKEN (comparacao timing-safe). */
export function tokenValido(authHeader: string | null): boolean {
  const token = process.env.JARVIS_API_TOKEN
  if (!token) return false
  const prefixo = 'Bearer '
  if (!authHeader || !authHeader.startsWith(prefixo)) return false
  return iguaisEmTempoConstante(authHeader.slice(prefixo.length), token)
}
