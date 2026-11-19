// Frase da falha da importação do Mercado Pago para quem gere a conciliação (#51): pela classe do erro, em linguagem
// simples e dizendo o que fazer. O detalhe técnico (status, caminho) fica no log e na resposta do cron.
import { RecusaUsuario } from '@/lib/resultado-action'
import { ErroMercadoPago } from './cliente'
import { FRASES_MP } from './frases'

export const FALHA_INTERNA = 'Não deu para importar. Tente de novo em alguns minutos.'

// Tempo esgotado (AbortSignal.timeout) e rede: o fetch sem rede lança TypeError 'fetch failed'; outro TypeError é bug.
const ehDeRede = (e: Error) =>
  e.name === 'TimeoutError' || e.name === 'AbortError' || (e instanceof TypeError && e.message === 'fetch failed')

export function fraseDaFalhaNaTela(e: unknown): string {
  // Credencial recusada já diz quem resolve e onde (point.ts); grupo sem credencial é frase do sistema.
  if (e instanceof ErroMercadoPago && (e.status === 401 || e.status === 403)) return e.message
  if (e instanceof RecusaUsuario) return e.message
  if (e instanceof ErroMercadoPago) return FRASES_MP.indisponivel
  if (e instanceof Error && ehDeRede(e)) return FRASES_MP.indisponivel
  return FALHA_INTERNA
}
