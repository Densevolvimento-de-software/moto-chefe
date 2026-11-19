// Cliente da API do Mercado Pago por token de grupo, para a conciliação da maquininha Point.
// O token vem do cadastro do grupo; nunca vai para mensagem de erro nem log.
import { chamarComToken, credencialRecusada, ErroMercadoPago } from './cliente'
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
    if (credencialRecusada(e)) {
      throw new ErroMercadoPago(
        `O Mercado Pago recusou a credencial deste grupo (HTTP ${e.status}). Peça ao administrador para cadastrá-la de novo em Grupos.`,
        e.status,
      )
    }
    throw e
  }
}

export type ContaMp = { id: string; nickname: string; tags: string[]; documento: string | null }

/**
 * A conta dona do token. `tags` traz 'test_user' na conta de teste e `identification` o documento do titular
 * (doc da API de usuários do Mercado Livre, a mesma do /users/me; não conferido numa conta real do MP).
 */
export async function consultarConta(token: string): Promise<ContaMp> {
  const r = await chamarGrupo<{ id: number | string; nickname: string; tags?: string[]; identification?: { number?: string } }>(token, '/users/me')
  return { id: String(r.id), nickname: r.nickname, tags: r.tags ?? [], documento: r.identification?.number ?? null }
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

const maisNovo = (a: PagamentoMp, b: PagamentoMp) =>
  Date.parse(b.date_last_updated) > Date.parse(a.date_last_updated) ? b : a

/** Uma entrada por id, na ordem em que o id apareceu primeiro; o mesmo id fica com o date_last_updated mais novo. */
export function juntarPorId(listas: PagamentoMp[][]): PagamentoMp[] {
  const porId = new Map<number, PagamentoMp>()
  for (const p of listas.flat()) {
    const antes = porId.get(p.id)
    porId.set(p.id, antes ? maisNovo(antes, p) : p)
  }
  return [...porId.values()]
}

/**
 * A busca da rodada: a mesma consulta 2 vezes, juntada por id. Na conta real a busca devolveu ora 9, ora 17
 * pagamentos (os cartões sumiam e voltavam); causa não achada na doc do MP, registrada na #51 (decisão B do Luis).
 */
export async function buscarPagamentosDaRodada(token: string, p: { inicio: Date; fim: Date }): Promise<PagamentoMp[]> {
  const primeira = await buscarPagamentosAlterados(token, p)
  const segunda = await buscarPagamentosAlterados(token, p)
  return juntarPorId([primeira, segunda])
}
