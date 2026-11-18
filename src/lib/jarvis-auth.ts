import { bearerConfere } from '@/lib/tempo-constante'

/** Confere o header Authorization contra JARVIS_API_TOKEN (comparacao timing-safe). */
export function tokenValido(authHeader: string | null): boolean {
  const token = process.env.JARVIS_API_TOKEN
  if (!token) return false
  return bearerConfere(authHeader, token)
}
