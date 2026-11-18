import { iguaisEmTempoConstante } from '@/lib/tempo-constante'

const PREFIXO = 'Bearer '

/**
 * Confere o CRON_SECRET das rotas de cron e da conciliação. O cron da Vercel manda
 * `Authorization: Bearer <segredo>`; a chamada manual e o agente da loja, `x-cron-secret`.
 * Sem o segredo no servidor, nada passa.
 */
export function cronAutorizado(req: Request): boolean {
  const segredo = process.env.CRON_SECRET
  if (!segredo) return false
  const bearer = req.headers.get('authorization')
  const manual = req.headers.get('x-cron-secret')
  return (bearer?.startsWith(PREFIXO) === true && iguaisEmTempoConstante(bearer.slice(PREFIXO.length), segredo))
    || (manual !== null && iguaisEmTempoConstante(manual, segredo))
}
