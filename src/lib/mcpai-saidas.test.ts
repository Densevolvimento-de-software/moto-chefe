// Fio de buscarSaidasOpenFinance com o mcp.ai falso só na fronteira: a rede (fetch) e a credencial do
// grupo (endpointMcpDoGrupo, que lê o banco). Prova o que sai do filtro, não a regra isolada.
import { afterEach, before, mock, test } from 'node:test'
import assert from 'node:assert/strict'

const CNPJ = '00000000000191'
const BANCO_A = 'Banco A Empresas'
const BANCO_B = 'Banco B Empresas'
const INICIO = new Date('2026-09-01T03:00:00.000Z')
const PERIODO = { inicio: new Date('2026-08-01T03:00:00.000Z'), fim: new Date('2026-09-30T02:59:59.000Z') }

const URL_FALSA = 'https://mcp.invalido.test/mcp'
mock.module('./mcpai-credencial', {
  namedExports: {
    credencialMcpDoGrupo: async () => ({ url: URL_FALSA, chavePropria: true, contasPixIds: [] }),
    endpointMcpDoGrupo: async () => URL_FALSA,
  },
})

type Tx = { id: string; date: string; amount: string; type: string; operationType: string; description: string }

const CONTAS = [
  { id: 'conta-a', bank: BANCO_A, subtype: 'CHECKING_ACCOUNT', taxNumber: CNPJ, name: 'A' },
  { id: 'conta-b', bank: BANCO_B, subtype: 'CHECKING_ACCOUNT', taxNumber: CNPJ, name: 'B' },
]

const SAIDAS: Record<string, Tx[]> = {
  'conta-a': [
    { id: 'a-antes', date: '2026-08-31T12:00:00.000Z', amount: '-10.00', type: 'DEBIT', operationType: 'PIX', description: 'PIX A antes' },
    { id: 'a-depois', date: '2026-09-02T12:00:00.000Z', amount: '-20.00', type: 'DEBIT', operationType: 'PIX', description: 'PIX A depois' },
    { id: 'a-credito', date: '2026-09-02T13:00:00.000Z', amount: '30.00', type: 'CREDIT', operationType: 'PIX', description: 'PIX entrada' },
  ],
  'conta-b': [
    { id: 'b-saida', date: '2026-09-02T12:00:00.000Z', amount: '-40.00', type: 'DEBIT', operationType: 'PIX', description: 'PIX B' },
  ],
}

const json = (corpo: unknown, sessao?: string) => new Response(
  `event: message\ndata: ${JSON.stringify(corpo)}\n\n`,
  { headers: sessao ? { 'mcp-session-id': sessao } : {} },
)

// Responde só o que o fio pede: initialize, contas, sync forçado e transações por conta.
function mcpFalso(url: string | URL, init?: RequestInit): Response {
  const corpo = JSON.parse(String(init?.body ?? '{}')) as { id: number; method: string; params?: { name?: string; arguments?: { account_id?: string } } }
  if (corpo.method === 'initialize') return json({ jsonrpc: '2.0', id: corpo.id, result: {} }, 's1')
  const nome = corpo.params?.name
  if (nome === 'openfinance_force_sync') return json({ jsonrpc: '2.0', id: corpo.id, result: {} })
  const texto = (payload: unknown) => ({ jsonrpc: '2.0', id: corpo.id, result: { content: [{ text: JSON.stringify(payload) }] } })
  if (nome === 'openfinance_list_accounts') return json(texto({ results: CONTAS }))
  if (nome === 'openfinance_list_transactions') {
    const txs = SAIDAS[corpo.params?.arguments?.account_id ?? ''] ?? []
    return json(texto({ total: txs.length, totalPages: 1, results: txs }))
  }
  throw new Error(`chamada inesperada ao mcp.ai falso: ${nome ?? corpo.method}`)
}

const fetchOriginal = globalThis.fetch
afterEach(() => { globalThis.fetch = fetchOriginal })

let buscarSaidasOpenFinance: typeof import('./mcpai').buscarSaidasOpenFinance
before(async () => {
  ;({ buscarSaidasOpenFinance } = await import('./mcpai'))
})

function idsDasSaidas(r: Awaited<ReturnType<typeof buscarSaidasOpenFinance>>): string[] {
  assert.equal(r.ok, true, r.ok ? '' : r.erro)
  return r.ok ? r.transacoes.map(t => t.transacaoId).sort() : []
}

test('banco liberado sem início: a saída de débito entra; o crédito e o banco de fora ficam de fora', async () => {
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => mcpFalso(url, init)) as typeof fetch
  const r = await buscarSaidasOpenFinance(PERIODO.inicio, PERIODO.fim, CNPJ, [{ banco: BANCO_A, inicioEm: null }])
  assert.deepEqual(idsDasSaidas(r), ['a-antes', 'a-depois'])
})

test('banco liberado com início: saída antes do início não entra; depois entra', async () => {
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => mcpFalso(url, init)) as typeof fetch
  const r = await buscarSaidasOpenFinance(PERIODO.inicio, PERIODO.fim, CNPJ, [{ banco: BANCO_A, inicioEm: INICIO }])
  assert.deepEqual(idsDasSaidas(r), ['a-depois'])
})

test('lista vazia do grupo: ok e nenhuma saída', async () => {
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => mcpFalso(url, init)) as typeof fetch
  const r = await buscarSaidasOpenFinance(PERIODO.inicio, PERIODO.fim, CNPJ, [])
  assert.deepEqual(r, { ok: true, transacoes: [], contasPuladas: [] })
})

test('a saída do banco que não está na lista do grupo fica de fora mesmo com outro banco liberado', async () => {
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => mcpFalso(url, init)) as typeof fetch
  const r = await buscarSaidasOpenFinance(PERIODO.inicio, PERIODO.fim, CNPJ, [{ banco: BANCO_B, inicioEm: null }])
  assert.deepEqual(idsDasSaidas(r), ['b-saida'])
})
