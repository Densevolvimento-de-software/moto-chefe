// Só para testes do cliente da Nota Gateway: troca o fetch global por uma resposta fixa e
// guarda o que foi pedido. Token e empresa sintéticos, para a asserção de vazamento.

export const cfgDeTeste = { token: 'TOKEN-SECRETO-123', empresaId: 'EMPRESA-SECRETA-456', ambiente: 'Homologacao' as const }

const fetchOriginal = globalThis.fetch

export type PedidoFeito = { url: string; init: RequestInit }

export function responderComFetch(status: number, corpo = ''): PedidoFeito[] {
  const pedidos: PedidoFeito[] = []
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    pedidos.push({ url, init })
    return new Response(corpo, { status })
  }) as typeof fetch
  return pedidos
}

export function restaurarFetch(): void {
  globalThis.fetch = fetchOriginal
}

/** NG que não responde: o fetch só termina quando o sinal do pedido aborta; sem sinal, fica pendurado para sempre. */
export function pendurarFetch(): PedidoFeito[] {
  const pedidos: PedidoFeito[] = []
  globalThis.fetch = ((url: string, init: RequestInit) => {
    pedidos.push({ url, init })
    return new Promise<Response>((_, rejeitar) => init.signal?.addEventListener('abort', () => rejeitar(init.signal?.reason)))
  }) as typeof fetch
  return pedidos
}
