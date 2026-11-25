// Rótulos dos ids da chave (#253), com o mcp.ai falso só na fronteira (fetch). Prova o que sai para a tela:
// banco e tipo, nada de número, agência ou CNPJ, e frase genérica quando o mcp.ai falha.
import { afterEach, before, test } from 'node:test'
import assert from 'node:assert/strict'

const URL_COM_SEGREDO = 'https://mcp.invalido.test/mcp/segredo-da-chave-ficticio'
const NUMERO = '12345-6'
const CNPJ_DA_CONTA = '99999999000199'
const AGENCIA = 'Agência: 0001 | Conta: 12345-6'

const BANK = [
  { id: 'conta-1', item_id: 'cred-1', bank: 'Banco B', subtype: 'CHECKING_ACCOUNT', number: NUMERO, taxNumber: CNPJ_DA_CONTA, name: 'B', marketingName: AGENCIA },
  { id: 'conta-2', item_id: 'cred-1', bank: 'Banco B', subtype: 'CHECKING_ACCOUNT', number: '99999-9', taxNumber: CNPJ_DA_CONTA, name: 'B', marketingName: AGENCIA },
  { id: 'poup-1', item_id: 'cred-1', bank: 'Banco B', subtype: 'SAVINGS_ACCOUNT', number: '11111-1', taxNumber: CNPJ_DA_CONTA, name: 'B' },
  // Londrina (#861): sem "bank"; o nome vem de name, e o marketingName é a agência e a conta (não pode vazar).
  // Sem bank e sem name: o único nome é o marketingName, que traz agência e conta e não pode ir para a tela.
  { id: 'conta-m', item_id: 'cred-m', subtype: 'CHECKING_ACCOUNT', number: '77777-7', taxNumber: CNPJ_DA_CONTA, marketingName: AGENCIA },
  { id: 'conta-s', item_id: 'cred-s', subtype: 'CHECKING_ACCOUNT', number: '55555-5', taxNumber: CNPJ_DA_CONTA, name: 'Sicoob Kojo', marketingName: AGENCIA },
]
// Formato real da lista CREDIT: o cartão vem em account_id e sem id (é o que buscarFaturasCartao lê).
const CREDIT = [
  { account_id: 'cartao-1', item_id: 'cred-c', bank: 'Sicoob', subtype: 'CREDIT_CARD', number: '4000-0000', name: 'Cartão' },
]

const json = (corpo: unknown, sessao?: string) => new Response(
  `event: message\ndata: ${JSON.stringify(corpo)}\n\n`,
  { headers: sessao ? { 'mcp-session-id': sessao } : {} },
)
let tipos: string[] = []
let comportamento: 'ok' | 'erro-initialize' | 'erro-lista' | 'rede-cai' = 'ok'

function mcpFalso(init?: RequestInit): Response {
  if (comportamento === 'rede-cai') throw new TypeError(`fetch failed: ${URL_COM_SEGREDO}`)
  const corpo = JSON.parse(String(init?.body ?? '{}')) as { id: number; method: string; params?: { arguments?: { type?: string } } }
  if (corpo.method === 'initialize') {
    return comportamento === 'erro-initialize'
      ? json({ jsonrpc: '2.0', id: corpo.id, error: { message: `token ${URL_COM_SEGREDO} recusado` } })
      : json({ jsonrpc: '2.0', id: corpo.id, result: {} }, 's1')
  }
  const tipo = corpo.params?.arguments?.type ?? ''
  tipos.push(tipo)
  if (comportamento === 'erro-lista') return json({ jsonrpc: '2.0', id: corpo.id, error: { message: `falhou em ${URL_COM_SEGREDO}` } })
  const results = tipo === 'CREDIT' ? CREDIT : BANK
  return json({ jsonrpc: '2.0', id: corpo.id, result: { content: [{ text: JSON.stringify({ results }) }] } })
}

const fetchOriginal = globalThis.fetch
afterEach(() => { globalThis.fetch = fetchOriginal; tipos = []; comportamento = 'ok' })

let mcpai: typeof import('./mcpai')
before(async () => { mcpai = await import('./mcpai') })

async function rotular() {
  globalThis.fetch = (async (_url: string | URL, init?: RequestInit) => mcpFalso(init)) as typeof fetch
  return mcpai.rotulosDasContasDaChave(URL_COM_SEGREDO)
}

test('traz um rótulo por conta, por credencial e por cartão, com o nome do banco', async () => {
  const r = await rotular()
  assert.equal(r.ok, true)
  const texto = Object.fromEntries(r.ok ? r.rotulos.map(x => [x.id, x.texto]) : [])
  assert.equal(texto['conta-1'], 'Banco B, conta')
  assert.equal(texto['cred-1'], 'Banco B, credencial, 2 contas correntes')
  assert.equal(texto['poup-1'], 'Banco B, poupança (não entra no PIX)')
  assert.equal(texto['conta-s'], 'Sicoob Kojo, conta')
  assert.equal(texto['cartao-1'], 'Sicoob, cartão (não entra no PIX)')
  assert.equal(texto['cred-c'], 'Sicoob, credencial, só cartão (não entra no PIX)')
})

test('conta sem bank nem name usa o texto padrão: o marketingName (agência e conta) não vira rótulo', async () => {
  const r = await rotular()
  const texto = Object.fromEntries(r.ok ? r.rotulos.map(x => [x.id, x.texto]) : [])
  assert.equal(texto['conta-m'], 'Banco não informado, conta')
})

test('pede as listas BANK e CREDIT, uma de cada vez e nessa ordem', async () => {
  await rotular()
  assert.deepEqual(tipos, ['BANK', 'CREDIT'])
})

test('nada de número, agência, CNPJ ou URL sai no resultado', async () => {
  const r = await rotular()
  const saida = JSON.stringify(r)
  for (const proibido of [NUMERO, '99999-9', '4000-0000', CNPJ_DA_CONTA, '0001', 'Agência', URL_COM_SEGREDO, 'segredo-da-chave']) {
    assert.equal(saida.includes(proibido), false, `vazou: ${proibido}`)
  }
})

for (const [caso, esperado] of [['erro-initialize', 'o initialize recusa'], ['erro-lista', 'a listagem recusa'], ['rede-cai', 'a rede cai']] as const) {
  test(`quando ${esperado}, volta a frase genérica, sem a URL nem o corpo do erro`, async () => {
    comportamento = caso
    const r = await rotular()
    assert.deepEqual(r, { ok: false, erro: 'Não foi possível consultar o mcp.ai agora.' })
  })
}
