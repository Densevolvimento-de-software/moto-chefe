// Cliente da API do Mercado Pago por token de grupo, para a conciliação da maquininha Point.
// O token vem do cadastro do grupo; nunca vai para mensagem de erro nem log.
import { chamarComToken, ErroMercadoPago } from './cliente'
import type { Pagamento } from './webhook'

// Mesmo recurso /v1/payments da mensalidade (webhook.ts), com os campos que a maquininha lê.
export type PagamentoMp = Pagamento & {
  id: number
  status_detail?: string
  payment_type_id: string
  payment_method_id: string
  transaction_amount_refunded?: number
  installments: number
  date_created: string
  date_approved: string | null
  date_last_updated: string
  authorization_code?: string | null
  transaction_details?: { net_received_amount?: number }
  point_of_interaction?: { type?: string; device?: { serial_number?: string } }
  card?: { last_four_digits?: string }
  payer?: { first_name?: string; last_name?: string }
}

const POR_PAGINA = 100

async function chamarGrupo<T>(token: string, caminho: string): Promise<T> {
  try {
    return await chamarComToken<T>(token, caminho, { method: 'GET' })
  } catch (e) {
    if (e instanceof ErroMercadoPago && (e.status === 401 || e.status === 403)) {
      throw new ErroMercadoPago(
        `Credencial do Mercado Pago recusada (HTTP ${e.status}). Cadastre o token novo.`,
        e.status,
      )
    }
    throw e
  }
}

export async function consultarConta(token: string): Promise<{ id: string; nickname: string }> {
  const r = await chamarGrupo<{ id: number | string; nickname: string }>(token, '/users/me')
  return { id: String(r.id), nickname: r.nickname }
}

/** Pagamentos alterados no período (por date_last_updated), paginados até o total. */
export async function buscarPagamentosAlterados(
  token: string,
  p: { inicio: Date; fim: Date },
): Promise<PagamentoMp[]> {
  const todos: PagamentoMp[] = []
  let offset = 0
  for (;;) {
    const qs = new URLSearchParams({
      range: 'date_last_updated',
      begin_date: p.inicio.toISOString(),
      end_date: p.fim.toISOString(),
      sort: 'date_last_updated',
      criteria: 'asc',
      limit: String(POR_PAGINA),
      offset: String(offset),
    })
    const r = await chamarGrupo<{ paging?: { total?: number }; results?: PagamentoMp[] }>(
      token, `/v1/payments/search?${qs}`,
    )
    const pagina = r.results ?? []
    todos.push(...pagina)
    offset += pagina.length
    // Página incompleta é a última; o total, quando vem, também encerra (resposta sem total não corta a busca).
    const total = r.paging?.total
    if (pagina.length < POR_PAGINA || (total !== undefined && offset >= total)) break
  }
  return todos
}
