import { test, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { buscarPagamentosAlterados, buscarPagamentosDaRodada, consultarConta, juntarPorId, type PagamentoMp } from './point'
import { ErroMercadoPago } from './cliente'

const TOKEN = 'TEST-tok-0000'
const original = globalThis.fetch
afterEach(() => { globalThis.fetch = original })

type Chamada = { url: URL; headers: Record<string, string> }
function mockFetch(respostas: Array<{ status?: number; body: unknown }>): Chamada[] {
  const chamadas: Chamada[] = []
  let i = 0
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    chamadas.push({ url: new URL(String(input)), headers: (init?.headers ?? {}) as Record<string, string> })
    const r = respostas[Math.min(i++, respostas.length - 1)]
    const status = r.status ?? 200
    return { ok: status >= 200 && status < 300, status, json: async () => r.body } as Response
  }) as typeof fetch
  return chamadas
}
const pagamentos = (n: number, ini = 0) => Array.from({ length: n }, (_, k) => ({ id: ini + k }))
const periodo = { inicio: new Date('2026-11-01T00:00:00.000Z'), fim: new Date('2026-11-02T00:00:00.000Z') }

test('pagina até o total', async () => {
  const chamadas = mockFetch([
    { body: { paging: { total: 137, limit: 100, offset: 0 }, results: pagamentos(100) } },
    { body: { paging: { total: 137, limit: 100, offset: 100 }, results: pagamentos(37, 100) } },
  ])
  const r = await buscarPagamentosAlterados(TOKEN, periodo)
  assert.equal(r.length, 137)
  assert.equal(chamadas.length, 2)
  assert.equal(chamadas[0].url.searchParams.get('offset'), '0')
  assert.equal(chamadas[1].url.searchParams.get('offset'), '100')
  assert.equal(chamadas[0].url.searchParams.get('range'), 'date_last_updated')
  assert.equal(chamadas[0].url.searchParams.get('sort'), 'date_last_updated')
  assert.equal(chamadas[0].url.searchParams.get('criteria'), 'asc')
  assert.equal(chamadas[0].url.searchParams.get('limit'), '100')
})

test('manda Bearer e as datas em ISO', async () => {
  const chamadas = mockFetch([{ body: { paging: { total: 0 }, results: [] } }])
  await buscarPagamentosAlterados(TOKEN, periodo)
  assert.equal(chamadas[0].headers.Authorization, `Bearer ${TOKEN}`)
  assert.equal(chamadas[0].url.searchParams.get('begin_date'), '2026-11-01T00:00:00.000Z')
  assert.equal(chamadas[0].url.searchParams.get('end_date'), '2026-11-02T00:00:00.000Z')
})

test('401 vira mensagem de credencial recusada sem o token', async () => {
  mockFetch([{ status: 401, body: { message: `invalid ${TOKEN}` } }])
  await assert.rejects(buscarPagamentosAlterados(TOKEN, periodo), (err: unknown) => {
    assert.ok(err instanceof ErroMercadoPago)
    assert.equal(err.status, 401)
    // Sem apontar tela: a do cadastro ainda não existe (#51).
    assert.equal(err.message, 'Credencial do Mercado Pago recusada (HTTP 401). Cadastre o token novo.')
    assert.ok(!err.message.includes(TOKEN))
    return true
  })
})

test('consultarConta devolve id como string', async () => {
  const chamadas = mockFetch([{ body: { id: 123456, nickname: 'LOJA BH', email: 'x@y.z' } }])
  assert.deepEqual(await consultarConta(TOKEN), { id: '123456', nickname: 'LOJA BH' })
  assert.equal(chamadas[0].url.pathname, '/users/me')
})

test('sem paging.total segue até vir página incompleta', async () => {
  const chamadas = mockFetch([
    { body: { results: pagamentos(100) } },
    { body: { results: pagamentos(20, 100) } },
  ])
  const r = await buscarPagamentosAlterados(TOKEN, periodo)
  assert.equal(r.length, 120)
  assert.equal(chamadas.length, 2)
})

test('403 também vira credencial recusada sem o token', async () => {
  mockFetch([{ status: 403, body: { message: `forbidden ${TOKEN}` } }])
  await assert.rejects(buscarPagamentosAlterados(TOKEN, periodo), (err: unknown) => {
    assert.ok(err instanceof ErroMercadoPago)
    assert.equal(err.status, 403)
    assert.equal(err.message, 'Credencial do Mercado Pago recusada (HTTP 403). Cadastre o token novo.')
    return true
  })
})

// Decisão B do Luis (#51): a mesma busca do MP devolve ora 9, ora 17 (os cartões somem e voltam). A rodada busca 2
// vezes e junta por id.
test('rodada busca 2 vezes e junta: 1ª devolve 1, 2ª devolve 3 com o mesmo de antes, ficam 3', async () => {
  const chamadas = mockFetch([
    { body: { paging: { total: 1 }, results: pagamentos(1, 5) } },
    { body: { paging: { total: 3 }, results: pagamentos(3, 4) } },
  ])
  const r = await buscarPagamentosDaRodada(TOKEN, periodo)
  assert.deepEqual(r.map(p => p.id).sort(), [4, 5, 6])
  assert.equal(chamadas.length, 2)
})

const alterado = (id: number, status: string, quando: string) =>
  ({ id, status, date_last_updated: quando }) as PagamentoMp

test('juntarPorId: o mesmo id nas duas listas fica uma vez, com a versão de date_last_updated mais nova', () => {
  const aprovado = alterado(7, 'approved', '2026-11-10T14:00:05.000-03:00')
  const estornado = alterado(7, 'refunded', '2026-11-11T09:00:00.000-03:00')
  const outro = alterado(8, 'approved', '2026-11-10T15:00:00.000-03:00')
  assert.deepEqual(juntarPorId([[aprovado, outro], [estornado]]), [estornado, outro])
  assert.deepEqual(juntarPorId([[estornado], [aprovado, outro]]), [estornado, outro])
})

test('juntarPorId: a mesma lista 2 vezes não repete nada', () => {
  const lista = [alterado(1, 'approved', '2026-11-10T10:00:00Z'), alterado(2, 'approved', '2026-11-10T11:00:00Z')]
  assert.deepEqual(juntarPorId([lista, lista]), lista)
})

// A importação busca tudo antes de gravar: a 2ª busca falhando não pode deixar passar só a 1ª.
test('rodada: a 2ª busca recusada rejeita, sem devolver a 1ª', async () => {
  const chamadas = mockFetch([
    { body: { paging: { total: 1 }, results: pagamentos(1) } },
    { status: 401, body: { message: 'unauthorized' } },
  ])
  await assert.rejects(buscarPagamentosDaRodada(TOKEN, periodo), (err: unknown) => err instanceof ErroMercadoPago && err.status === 401)
  assert.equal(chamadas.length, 2)
})
