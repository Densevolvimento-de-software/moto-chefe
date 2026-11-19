// Frase da falha da importação do Mercado Pago para quem gere a conciliação (#51): pela classe do erro, em linguagem
// simples e dizendo o que fazer. O detalhe técnico (status, caminho) fica no log e na resposta do cron.
import { RecusaUsuario } from '@/lib/resultado-action'
import { ErroMercadoPago } from './cliente'
import { FRASES_MP } from './frases'

export const FALHA_INTERNA = 'Não deu para importar. Tente de novo em alguns minutos.'

// Tempo esgotado (AbortSignal.timeout) e rede (fetch failed) chegam com estes nomes.
const NOMES_DE_REDE = new Set(['TimeoutError', 'AbortError', 'TypeError'])

export function fraseDaFalhaNaTela(e: unknown): string {
  // Credencial recusada já diz quem resolve e onde (point.ts); grupo sem credencial é frase do sistema.
  if (e instanceof ErroMercadoPago && (e.status === 401 || e.status === 403)) return e.message
  if (e instanceof RecusaUsuario) return e.message
  if (e instanceof ErroMercadoPago) return FRASES_MP.indisponivel
  if (e instanceof Error && NOMES_DE_REDE.has(e.name)) return FRASES_MP.indisponivel
  return FALHA_INTERNA
}
