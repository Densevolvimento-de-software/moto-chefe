// Fio de buscarPixRecebidos / buscarSaidasOpenFinance com o mcp.ai falso só na fronteira: a rede (fetch) e a
// credencial do grupo (credencialMcpDoGrupo, que lê o banco). Prova em que tela a conta liberada (#236) entra.
import { afterEach, before, mock, test } from 'node:test'
import assert from 'node:assert/strict'

const CNPJ = '00000000000191'
const PERIODO = { inicio: new Date('2026-08-01T03:00:00.000Z'), fim: new Date('2026-09-30T02:59:59.000Z') }
const URL_FALSA = 'https://mcp.invalido.test/mcp'

let credencial = { url: URL_FALSA, chavePropria: true, contasPixIds: [] as string[] }
mock.module('./mcpai-credencial', {
  namedExports: {
    credencialMcpDoGrupo: async () => credencial,
    endpointMcpDoGrupo: async () => URL_FALSA,
  },
})

const CONTAS = [
  { id: 'conta-grupo', bank: 'Banco A', subtype: 'CHECKING_ACCOUNT', taxNumber: CNPJ, name: 'A' },
  { id: 'conta-outra', bank: 'Banco B', subtype: 'CHECKING_ACCOUNT', taxNumber: '99999999000199', name: 'B' },
]
const tx = (id: string, type: 'CREDIT' | 'DEBIT') => ({
  id, date: '2026-09-02T12:00:00.000Z', amount: type === 'CREDIT' ? '10.00' : '-10.00', type, operationType: 'PIX', description: id,
})
const TRANSACOES: Record<string, ReturnType<typeof tx>[]> = {
  'conta-grupo': [tx('pix-grupo', 'CREDIT'), tx('saida-grupo', 'DEBIT')],
  'conta-outra': [tx('pix-outra', 'CREDIT'), tx('saida-outra', 'DEBIT')],
}

const json = (corpo: unknown, sessao?: string) => new Response(
  `event: message\ndata: ${JSON.stringify(corpo)}\n\n`,
  { headers: sessao ? { 'mcp-session-id': sessao } : {} },
)

let contasLidas: string[] = []
function mcpFalso(init?: RequestInit): Response {
  const corpo = JSON.parse(String(init?.body ?? '{}')) as { id: number; method: string; params?: { name?: string; arguments?: { account_id?: string } } }
  if (corpo.method === 'initialize') return json({ jsonrpc: '2.0', id: corpo.id, result: {} }, 's1')
  const nome = corpo.params?.name
  if (nome === 'openfinance_force_sync') return json({ jsonrpc: '2.0', id: corpo.id, result: {} })
  const texto = (payload: unknown) => ({ jsonrpc: '2.0', id: corpo.id, result: { content: [{ text: JSON.stringify(payload) }] } })
  if (nome === 'openfinance_list_accounts') return json(texto({ results: CONTAS }))
  if (nome === 'openfinance_list_transactions') {
    const conta = corpo.params?.arguments?.account_id ?? ''
    contasLidas.push(conta)
    const txs = TRANSACOES[conta] ?? []
    return json(texto({ total: txs.length, totalPages: 1, results: txs }))
  }
  throw new Error(`chamada inesperada ao mcp.ai falso: ${nome ?? corpo.method}`)
}

const fetchOriginal = globalThis.fetch
afterEach(() => {
  globalThis.fetch = fetchOriginal
  contasLidas = []
  credencial = { url: URL_FALSA, chavePropria: true, contasPixIds: [] }
})

let mcpai: typeof import('./mcpai')
before(async () => {
  mcpai = await import('./mcpai')
})

async function pixLidos(): Promise<string[]> {
  globalThis.fetch = (async (_url: string | URL, init?: RequestInit) => mcpFalso(init)) as typeof fetch
  const r = await mcpai.buscarPixRecebidos(PERIODO.inicio, PERIODO.fim, CNPJ)
  assert.equal(r.ok, true, r.ok ? '' : r.erro)
  return r.ok ? r.transacoes.map(t => t.transacaoId).sort() : []
}

test('PIX com id liberado e chave própria traz a conta do CNPJ do grupo e a liberada', async () => {
  credencial = { ...credencial, contasPixIds: ['conta-outra'] }
  assert.deepEqual(await pixLidos(), ['pix-grupo', 'pix-outra'])
})

test('PIX sem nenhuma conta liberada traz só a conta do CNPJ do grupo', async () => {
  assert.deepEqual(await pixLidos(), ['pix-grupo'])
  assert.deepEqual(contasLidas, ['conta-grupo'])
})

test('PIX com id gravado mas sem chave própria (chave global) ignora o id', async () => {
  credencial = { ...credencial, chavePropria: false, contasPixIds: ['conta-outra'] }
  assert.deepEqual(await pixLidos(), ['pix-grupo'])
  assert.deepEqual(contasLidas, ['conta-grupo'])
})

test('id liberado que o mcp.ai não lista é ignorado, sem erro', async () => {
  credencial = { ...credencial, contasPixIds: ['conta-que-nao-existe'] }
  assert.deepEqual(await pixLidos(), ['pix-grupo'])
})

test('Despesas não lê a conta liberada para o PIX, mesmo com o banco dela liberado em Despesas', async () => {
  credencial = { ...credencial, contasPixIds: ['conta-outra'] }
  globalThis.fetch = (async (_url: string | URL, init?: RequestInit) => mcpFalso(init)) as typeof fetch
  const liberadas = [{ banco: 'Banco A', inicioEm: null }, { banco: 'Banco B', inicioEm: null }]
  const r = await mcpai.buscarSaidasOpenFinance(PERIODO.inicio, PERIODO.fim, CNPJ, liberadas)
  assert.equal(r.ok, true, r.ok ? '' : r.erro)
  assert.deepEqual(r.ok ? r.transacoes.map(t => t.transacaoId) : [], ['saida-grupo'])
  assert.deepEqual(contasLidas, ['conta-grupo'])
})
