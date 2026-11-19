import { useState } from 'react'
import type { ResultadoAction } from '@/lib/resultado-action'

/**
 * POST para um Route Handler que leva de segundos a minutos (sincronizar o banco, importar a maquininha). Route
 * Handler, não Server Action: o Next despacha as Server Actions uma por vez por cliente, e uma de minutos
 * travaria as outras ações da tela. Devolve o corpo da rota em `dados`, ou a recusa dela (`{ error }`: sessão,
 * permissão) e a falha de rede como frase em `erro`. Quem usa decide o aviso e o refresh.
 */
export function useAcaoDemorada<R>(rota: string) {
  const [pendente, setPendente] = useState(false)

  async function disparar(corpo: unknown): Promise<ResultadoAction<R>> {
    setPendente(true)
    try {
      const resp = await fetch(rota, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) })
      const r = (await resp.json()) as R | { error: string }
      if (r !== null && typeof r === 'object' && 'error' in r) return { ok: false, erro: String(r.error) }
      return { ok: true, dados: r as R }
    } catch {
      return { ok: false, erro: 'falha ao falar com o servidor' }
    } finally {
      setPendente(false)
    }
  }

  return { pendente, disparar }
}
