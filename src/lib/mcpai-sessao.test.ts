// Saldos e cartões abrem a sessão e listam as contas pelo mesmo caminho do PIX e das Despesas. Aqui, só a fronteira
// de fora (fetch e credencial) é falsa: prova a frase de cada recusa da sessão e o tipo de conta que cada leitor pede.
import { afterEach, before, mock, test } from 'node:test'
import assert from 'node:assert/strict'

const CNPJ = '00000000000191'
mock.module('./mcpai-credencial', {
  namedExports: {
    credencialMcpDoGrupo: async () => ({ url: 'https://mcp.invalido.test/mcp', chavePropria: true, contasPixIds: [] }),
    endpointMcpDoGrupo: async () => 'https://mcp.invalido.test/mcp',
  },
})

const json = (corpo: unknown, sessao?: string) => new Response(
  `event: message\ndata: ${JSON.stringify(corpo)}\n\n`,
  { headers: sessao ? { 'mcp-session-id': sessao } : {} },
)
type Chamada = { method: string; tipo?: string }
let chamadas: Chamada[] = []

function falso(init: (id: number) => Response) {
  globalThis.fetch = (async (_url: string | URL, req?: RequestInit) => {
    const corpo = JSON.parse(String(req?.body ?? '{}')) as { id: number; method: string; params?: { arguments?: { type?: string } } }
    chamadas.push({ method: corpo.method, tipo: corpo.params?.arguments?.type })
    if (corpo.method === 'initialize') return init(corpo.id)
    return json({ jsonrpc: '2.0', id: corpo.id, result: { content: [{ text: JSON.stringify({ results: [] }) }] } })
  }) as typeof fetch
}

const fetchOriginal = globalThis.fetch
afterEach(() => { globalThis.fetch = fetchOriginal; chamadas = [] })

let mcpai: typeof import('./mcpai')
before(async () => { mcpai = await import('./mcpai') })

const LEITORES = [
  ['saldos', () => mcpai.buscarSaldosBancarios(CNPJ)],
  ['cartões', () => mcpai.buscarFaturasCartao(CNPJ)],
] as const

for (const [nome, ler] of LEITORES) {
  test(`${nome}: erro do initialize volta com a frase do mcp.ai e nada mais é chamado`, async () => {
    falso(id => json({ jsonrpc: '2.0', id, error: { message: 'sessão recusada' } }))
    assert.deepEqual(await ler(), { ok: false, erro: 'sessão recusada' })
    assert.deepEqual(chamadas.map(c => c.method), ['initialize'])
  })

  test(`${nome}: initialize sem identificador de sessão recusa com a frase própria`, async () => {
    falso(id => json({ jsonrpc: '2.0', id, result: {} }))
    assert.deepEqual(await ler(), { ok: false, erro: 'mcp.ai não retornou identificador de sessão' })
  })
}

test('saldos pedem só a lista BANK; cartões pedem BANK (para o CNPJ) e depois CREDIT', async () => {
  falso(id => json({ jsonrpc: '2.0', id, result: {} }, 's1'))
  await mcpai.buscarSaldosBancarios(CNPJ)
  assert.deepEqual(chamadas.filter(c => c.tipo).map(c => c.tipo), ['BANK'])
  chamadas = []
  await mcpai.buscarFaturasCartao(CNPJ)
  assert.deepEqual(chamadas.filter(c => c.tipo).map(c => c.tipo), ['BANK', 'CREDIT'])
})
