// Teste de banco: GET /api/v1/metas (#326) chamado com um Request, no banco do test:db. Dados gravados de verdade e
// apagados no after. Os arquivos do test:db rodam em paralelo no mesmo banco: cada conferência filtra pelos ids das
// lojas deste teste, e os meses usados são de 2026 e de 2031.
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { inArray, sql } from 'drizzle-orm'
import { NextRequest } from 'next/server'
import { apagarContasSemeadas } from '@/test/semear-conta'
import { mockAfterDaResposta } from '@/test/after-resposta'
import { semearChaveDaApi, semearContaDaApi, semearLojaDaApi } from '@/test/api-leitura-semear'

const url = process.env.TEST_DATABASE_URL
if (!url) throw new Error('TEST_DATABASE_URL não definida — este teste só roda num Postgres descartável')
if (!['localhost', '127.0.0.1'].includes(new URL(url).hostname)) {
  throw new Error('TEST_DATABASE_URL precisa ser loopback (Postgres descartável)')
}
process.env.DATABASE_URL = url

type Db = typeof import('@/lib/db')
type Schema = typeof import('@/lib/db/schema')
type Rota = typeof import('./route')
let db: Db['db']
let execRows: Db['execRows']
let apiAcessos: Schema['apiAcessos']
let apiLimite: Schema['apiLimite']
let apiChaves: Schema['apiChaves']
let metasLoja: Schema['metasLoja']
let esperarRegistros: () => Promise<void>
let GET: Rota['GET']

const ENDPOINT = '/api/v1/metas'
const TOKEN = `chave-mt326-${randomUUID()}`
const contaIds: string[] = []
const prefixos: string[] = []
const lojaIds: string[] = []
const uas: string[] = []
let chaveId = ''

type Meta = { ano: number; mes: number; loja: { id: string; nome: string }; valor: number }
type Corpo = { metas?: Meta[]; proximaPagina?: string | null; codigo?: string; frase?: string }

async function chamar(query: string, token: string | null = TOKEN) {
  const ua = `mt326-${randomUUID()}`
  uas.push(ua)
  const headers = new Headers({ 'user-agent': ua, 'x-forwarded-for': '200.3.4.5' })
  if (token !== null) headers.set('authorization', `Bearer ${token}`)
  const resposta = await GET(new NextRequest(`http://localhost${ENDPOINT}${query}`, { headers }))
  const texto = await resposta.text()
  return { status: resposta.status, texto, corpo: JSON.parse(texto) as Corpo, ua }
}

const ACESSO_NEGADO = { codigo: 'acesso_negado', frase: 'Acesso negado.' }
const PARAMETRO_INVALIDO = { codigo: 'parametro_invalido', frase: 'Parâmetro inválido.' }

// Contas e lojas da semente. A (autorizada) tem loja marcada e não marcada; B não é autorizada; C está desativada;
// D tem grupo inativo.
let A: { contaId: string; grupoId: string }
let B: { contaId: string; grupoId: string }
let C: { contaId: string; grupoId: string }
let D: { contaId: string; grupoId: string }
const LOJA = {
  a1: 'Loja Sintética MT326 A1', a2: 'Loja Sintética MT326 A2 sem marca', a3: 'Loja Sintética MT326 A3 desmarcada',
  b1: 'Loja Sintética MT326 B1 sem autorização', c1: 'Loja Sintética MT326 C1 desativada', d1: 'Loja Sintética MT326 D1 grupo inativo',
}
const id: Record<keyof typeof LOJA, string> = { a1: '', a2: '', a3: '', b1: '', c1: '', d1: '' }

async function semearConta(prefixo: string, cnpj: string, opcoes: { autorizada?: boolean; desativada?: boolean; grupoInativo?: boolean }) {
  const base = await semearContaDaApi(db, { prefixo, cnpj, ...opcoes })
  contaIds.push(base.contaId)
  prefixos.push(prefixo)
  lojaIds.push(base.lojaId)
  return base
}

async function semearMeta(lojaId: string, ano: number, mes: number, valor: string) {
  await db.insert(metasLoja).values({ lojaId, ano, mes, valorMeta: valor })
}

before(async () => {
  ;({ esperarRegistros } = await mockAfterDaResposta())
  ;({ db, execRows } = await import('@/lib/db'))
  ;({ apiAcessos, apiLimite, apiChaves, metasLoja } = await import('@/lib/db/schema'))
  ;({ GET } = await import('./route'))

  const chave = await semearChaveDaApi(db, TOKEN)
  chaveId = chave.id

  A = await semearConta('MT326A', '32600000000001', { autorizada: true })
  B = await semearConta('MT326B', '32600000000002', { autorizada: false })
  C = await semearConta('MT326C', '32600000000003', { autorizada: true, desativada: true })
  D = await semearConta('MT326D', '32600000000004', { autorizada: true, grupoInativo: true })

  id.a1 = await semearLojaDaApi(db, A.grupoId, LOJA.a1, { marcada: true })
  id.a2 = await semearLojaDaApi(db, A.grupoId, LOJA.a2, { marcada: false })
  id.a3 = await semearLojaDaApi(db, A.grupoId, LOJA.a3, { marcada: true })
  id.b1 = await semearLojaDaApi(db, B.grupoId, LOJA.b1, { marcada: true })
  id.c1 = await semearLojaDaApi(db, C.grupoId, LOJA.c1, { marcada: true })
  id.d1 = await semearLojaDaApi(db, D.grupoId, LOJA.d1, { marcada: true })
  lojaIds.push(id.a1, id.a2, id.a3, id.b1, id.c1, id.d1)

  await semearMeta(id.a1, 2026, 1, '12345.60')
  await semearMeta(id.a1, 2026, 2, '9000')
  await semearMeta(id.a2, 2026, 1, '5000')
  await semearMeta(id.a3, 2026, 3, '7000')
  await semearMeta(id.b1, 2026, 1, '6000')
  await semearMeta(id.c1, 2026, 1, '6100')
  await semearMeta(id.d1, 2026, 1, '6200')
})

after(async () => {
  await db.delete(apiAcessos).where(inArray(apiAcessos.userAgent, uas))
  await db.delete(apiAcessos).where(sql`chave_id = ${chaveId}`)
  await db.delete(apiLimite).where(sql`chave_id = ${chaveId}`)
  await db.delete(apiChaves).where(sql`id = ${chaveId}`)
  if (lojaIds.length > 0) await db.delete(metasLoja).where(inArray(metasLoja.lojaId, lojaIds))
  for (const [i, contaId] of contaIds.entries()) {
    await apagarContasSemeadas(db, { contaIds: [contaId], prefixo: prefixos[i] })
  }
  await (globalThis as { __pgPool?: { end(): Promise<void> } }).__pgPool?.end()
})

test('chave válida: sai a meta da loja marcada de Conta autorizada, com a lista de colunas', async () => {
  const { status, corpo } = await chamar('?de=2026-01&ate=2026-03')
  assert.equal(status, 200)
  const nossas = (corpo.metas ?? []).filter(m => m.loja.id === id.a1)
  assert.deepEqual(nossas, [
    { ano: 2026, mes: 1, loja: { id: id.a1, nome: LOJA.a1 }, valor: 12345.6 },
    { ano: 2026, mes: 2, loja: { id: id.a1, nome: LOJA.a1 }, valor: 9000 },
  ])
  for (const meta of nossas) assert.deepEqual(Object.keys(meta).sort(), ['ano', 'loja', 'mes', 'valor'])
})

test('loja marcada de Conta que não é autorizada: sem linha, e o id e o nome dela não aparecem na resposta', async () => {
  const { texto } = await chamar('?de=2026-01&ate=2026-03')
  assert.ok(!texto.includes(id.b1))
  assert.ok(!texto.includes(LOJA.b1))
})

test('loja de Conta autorizada sem marca: sem linha', async () => {
  const { texto } = await chamar('?de=2026-01&ate=2026-03')
  assert.ok(!texto.includes(id.a2))
  assert.ok(!texto.includes(LOJA.a2))
})

test('loja marcada depois desmarcada: sai na consulta anterior e some na seguinte', async () => {
  const antes = await chamar('?de=2026-03&ate=2026-03')
  assert.ok((antes.corpo.metas ?? []).some(m => m.loja.id === id.a3))
  await db.execute(sql`update lojas set loja_motochefe = false where id = ${id.a3}`)
  const depois = await chamar('?de=2026-03&ate=2026-03')
  assert.ok(!depois.texto.includes(id.a3))
})

test('Conta desativada e grupo inativo com loja marcada não saem', async () => {
  const { texto } = await chamar('?de=2026-01&ate=2026-01')
  assert.ok(!texto.includes(id.c1))
  assert.ok(!texto.includes(id.d1))
})

test('período fora da regra: 400 com a lista fixa, sem eco do valor pedido', async () => {
  const pedidos = [
    '?de=2025-12&ate=2026-03',
    '?de=2026-05&ate=2026-04',
    '?de=2026-01&ate=2027-01',
    '?de=2026-13&ate=2026-14',
    '?de=2026-01',
    '?ate=2026-03',
  ]
  for (const query of pedidos) {
    const { status, corpo, texto } = await chamar(query)
    assert.equal(status, 400, query)
    assert.deepEqual(corpo, PARAMETRO_INVALIDO, query)
    const valor = query.match(/\d{4}-\d{2}/)?.[0]
    if (valor) assert.ok(!texto.includes(valor), query)
  }
})

test('sem chave ou com chave errada: acesso negado, a mesma resposta, sem dado', async () => {
  const sem = await chamar('?de=2026-01&ate=2026-03', null)
  const errada = await chamar('?de=2026-01&ate=2026-03', 'chave-que-nao-existe')
  assert.equal(sem.status, 401)
  assert.deepEqual(sem.corpo, ACESSO_NEGADO)
  assert.equal(errada.texto, sem.texto)
  assert.ok(!sem.texto.includes(id.a1))
})

test('cursor adulterado, ou de mês fora do período pedido, é recusado com 400', async () => {
  const lixo = await chamar('?de=2026-01&ate=2026-03&cursor=não-é-cursor')
  assert.equal(lixo.status, 400)
  assert.deepEqual(lixo.corpo, PARAMETRO_INVALIDO)
  const doOutroPeriodo = Buffer.from(JSON.stringify({ a: 2031, m: 1, l: id.a1 })).toString('base64url')
  const fora = await chamar(`?de=2026-01&ate=2026-03&cursor=${doOutroPeriodo}`)
  assert.equal(fora.status, 400)
  assert.deepEqual(fora.corpo, PARAMETRO_INVALIDO)
})

test('página de 500, depois a seguinte: 516 metas de 43 lojas num ano, sem repetição nem perda', async () => {
  const lojas: string[] = []
  for (let i = 0; i < 43; i++) {
    const lojaId = await semearLojaDaApi(db, A.grupoId, `Loja Sintética MT326 pag ${i}`, { marcada: true })
    lojas.push(lojaId)
    lojaIds.push(lojaId)
  }
  const linhas = lojas.flatMap(lojaId => Array.from({ length: 12 }, (_, i) => ({ lojaId, ano: 2031, mes: i + 1, valorMeta: '100.00' })))
  await db.insert(metasLoja).values(linhas)

  const primeira = await chamar('?de=2031-01&ate=2031-12')
  assert.equal(primeira.status, 200)
  assert.equal(primeira.corpo.metas?.length, 500)
  assert.ok(primeira.corpo.proximaPagina)

  const segunda = await chamar(`?de=2031-01&ate=2031-12&cursor=${primeira.corpo.proximaPagina}`)
  assert.equal(segunda.status, 200)
  assert.equal(segunda.corpo.proximaPagina, null)

  const todas = [...(primeira.corpo.metas ?? []), ...(segunda.corpo.metas ?? [])]
  const chaves = new Set(todas.map(m => `${m.loja.id}-${m.ano}-${m.mes}`))
  assert.equal(todas.length, 516)
  assert.equal(chaves.size, 516)
  assert.ok(lojas.every(lojaId => todas.some(m => m.loja.id === lojaId)))
})

test('registro de acesso: uma linha por chamada, com o período de primeiro a último dia; a recusada também', async () => {
  const ok = await chamar('?de=2026-01&ate=2026-03')
  const recusada = await chamar('?de=2026-01&ate=2026-03', 'chave-que-nao-existe')
  await esperarRegistros()
  const linhas = await execRows(sql`
    select endpoint, status, chave_id, to_char(periodo_ini, 'YYYY-MM-DD') as ini, to_char(periodo_fim, 'YYYY-MM-DD') as fim
      from api_acessos where user_agent in (${ok.ua}, ${recusada.ua})`) as {
    endpoint: string; status: number; chave_id: string | null; ini: string | null; fim: string | null
  }[]
  const daOk = linhas.find(l => l.status === 200)
  const daRecusada = linhas.find(l => l.status === 401)
  assert.equal(linhas.length, 2)
  assert.deepEqual(daOk, { endpoint: ENDPOINT, status: 200, chave_id: chaveId, ini: '2026-01-01', fim: '2026-03-31' })
  assert.deepEqual(daRecusada, { endpoint: ENDPOINT, status: 401, chave_id: null, ini: null, fim: null })
})

test('registro de acesso: a chamada recusada com 400 também gera uma linha, sem período', async () => {
  const recusada = await chamar('?de=2025-12&ate=2026-03')
  await esperarRegistros()
  const linhas = await execRows(sql`
    select endpoint, status, chave_id, periodo_ini, periodo_fim, linhas from api_acessos where user_agent = ${recusada.ua}`)
  assert.deepEqual(linhas, [{ endpoint: ENDPOINT, status: 400, chave_id: chaveId, periodo_ini: null, periodo_fim: null, linhas: null }])
})

test('duas lojas no mesmo mês: a ordem é pelo id da loja, de forma estável', async () => {
  const primeira = await semearLojaDaApi(db, A.grupoId, 'Loja Sintética MT326 ordem 1', { marcada: true })
  const segunda = await semearLojaDaApi(db, A.grupoId, 'Loja Sintética MT326 ordem 2', { marcada: true })
  lojaIds.push(primeira, segunda)
  await semearMeta(primeira, 2032, 5, '100')
  await semearMeta(segunda, 2032, 5, '200')
  const { corpo } = await chamar('?de=2032-05&ate=2032-05')
  const ids = (corpo.metas ?? []).map(m => m.loja.id).filter(id => id === primeira || id === segunda)
  assert.deepEqual(ids, [primeira, segunda].sort())
})
