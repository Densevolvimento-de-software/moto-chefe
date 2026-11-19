import { useState } from 'react'

/** O que a rota devolveu, ou a recusa dela (`{ error }`: sessão, permissão) ou a falha de rede, como frase. */
export type RespostaDemorada<R> = { ok: true; corpo: R } | { ok: false; erro: string }

/**
 * POST para um Route Handler que leva de segundos a minutos (sincronizar o banco, importar a maquininha). Route
 * Handler, não Server Action: o Next despacha as Server Actions uma por vez por cliente, e uma de minutos
 * travaria as outras ações da tela. Quem usa decide o aviso e o refresh.
 */
export function useAcaoDemorada<R>(rota: string) {
  const [pendente, setPendente] = useState(false)

  async function disparar(corpo: unknown): Promise<RespostaDemorada<R>> {
    setPendente(true)
    try {
      const resp = await fetch(rota, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) })
      const r = (await resp.json()) as R | { error: string }
      if (r !== null && typeof r === 'object' && 'error' in r) return { ok: false, erro: String(r.error) }
      return { ok: true, corpo: r as R }
    } catch {
      return { ok: false, erro: 'falha ao falar com o servidor' }
    } finally {
      setPendente(false)
    }
  }

  return { pendente, disparar }
}
