// Teste de banco: toda rota de src/app/api/v1 passa pela casca de chave (#320).
// A lista vem do disco e cobre qualquer arquivo route.* (qualquer extensão). Para cada rota e cada método exportado
// (GET, HEAD, OPTIONS, POST, PUT, PATCH, DELETE): sem chave, recusa 401; com chave válida, deixa uma linha no
// registro com o endpoint da rota e soma 1 no contador da chave. Também confere o texto: o arquivo chama a casca.
// A ordem da casca (chave, limite, consulta, registro) é do teste da rota de lojas.
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { eq, inArray, sum } from 'drizzle-orm'
import { NextRequest } from 'next/server'
import { mockAfterDaResposta } from '@/test/after-resposta'

const url = process.env.TEST_DATABASE_URL
if (!url) throw new Error('TEST_DATABASE_URL não definida — este teste só roda num Postgres descartável')
if (!['localhost', '127.0.0.1'].includes(new URL(url).hostname)) {
  throw new Error('TEST_DATABASE_URL precisa ser loopback (Postgres descartável)')
}
process.env.DATABASE_URL = url

type Db = typeof import('@/lib/db')
type Schema = typeof import('@/lib/db/schema')
type Rota = Partial<Record<(typeof METODOS)[number], (req: NextRequest) => Promise<Response> | Response>>
let db: Db['db']
let apiChaves: Schema['apiChaves']
let apiAcessos: Schema['apiAcessos']
let apiLimite: Schema['apiLimite']
let esperarRegistros: () => Promise<void>

const APP = join(process.cwd(), 'src/app')
const RAIZ = join(APP, 'api/v1')
const METODOS = ['GET', 'HEAD', 'OPTIONS', 'POST', 'PUT', 'PATCH', 'DELETE'] as const
const ROTAS = readdirSync(RAIZ, { recursive: true, encoding: 'utf8' })
  .filter(caminho => /^route\.(ts|tsx|js|jsx|mjs|cjs)$/.test(caminho.split(sep).pop() ?? ''))
const endpointDaRota = (arquivo: string) => `/${relative(APP, dirname(join(RAIZ, arquivo))).split(sep).join('/')}`
const carregar = (arquivo: string): Promise<Rota> => import(pathToFileURL(join(RAIZ, arquivo)).href)

const sha = (texto: string) => createHash('sha256').update(texto).digest('hex')
const chavesCriadas: string[] = []
const uasCriados: string[] = []
const uaNovo = () => {
  const ua = `rotas-${randomUUID()}`
  uasCriados.push(ua)
  return ua
}
const chaveValida = async () => {
  const token = `rota-${randomUUID()}`
  const [linha] = await db.insert(apiChaves)
    .values({ hash: sha(token), geradaPor: randomUUID(), validaAte: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000) })
    .returning({ id: apiChaves.id })
  chavesCriadas.push(linha.id)
  return { token, id: linha.id }
}

before(async () => {
  ;({ esperarRegistros } = await mockAfterDaResposta())
  ;({ db } = await import('@/lib/db'))
  ;({ apiChaves, apiAcessos, apiLimite } = await import('@/lib/db/schema'))
})

after(async () => {
  if (uasCriados.length > 0) await db.delete(apiAcessos).where(inArray(apiAcessos.userAgent, uasCriados))
  if (chavesCriadas.length > 0) {
    await db.delete(apiAcessos).where(inArray(apiAcessos.chaveId, chavesCriadas))
    await db.delete(apiLimite).where(inArray(apiLimite.chaveId, chavesCriadas))
    await db.delete(apiChaves).where(inArray(apiChaves.id, chavesCriadas))
  }
  await (globalThis as { __pgPool?: { end(): Promise<void> } }).__pgPool?.end()
})

test('há pelo menos uma rota em src/app/api/v1 para conferir', () => {
  assert.ok(ROTAS.length > 0)
})

for (const arquivo of ROTAS) {
  test(`${arquivo}: o texto chama a casca comChaveDaApi`, () => {
    assert.match(readFileSync(join(RAIZ, arquivo), 'utf8'), /comChaveDaApi\(/)
  })
}

for (const arquivo of ROTAS) {
  test(`${arquivo}: sem Authorization, cada método exportado recusa com acesso negado`, async () => {
    const modulo = await carregar(arquivo)
    const exportados = METODOS.filter(metodo => typeof modulo[metodo] === 'function')
    assert.ok(exportados.length > 0, 'rota sem nenhum método exportado')
    for (const metodo of exportados) {
      const ua = uaNovo()
      const resposta = await modulo[metodo]!(new NextRequest(`http://localhost${endpointDaRota(arquivo)}`, { method: metodo, headers: { 'user-agent': ua } }))
      assert.equal(resposta.status, 401, metodo)
      assert.deepEqual(await resposta.json(), { codigo: 'acesso_negado', frase: 'Acesso negado.' }, metodo)
    }
  })
}

for (const arquivo of ROTAS) {
  test(`${arquivo}: com chave válida, cada método exportado deixa uma linha no registro e soma 1 no contador`, async () => {
    const modulo = await carregar(arquivo)
    const endpoint = endpointDaRota(arquivo)
    assert.doesNotMatch(endpoint, /\[/, 'caminho dinâmico: este teste ainda não monta um caminho concreto')
    const exportados = METODOS.filter(metodo => typeof modulo[metodo] === 'function')
    assert.ok(exportados.length > 0, 'rota sem nenhum método exportado')
    for (const metodo of exportados) {
      const chave = await chaveValida()
      const ua = uaNovo()
      const resposta = await modulo[metodo]!(new NextRequest(`http://localhost${endpoint}`, {
        method: metodo, headers: { authorization: `Bearer ${chave.token}`, 'user-agent': ua },
      }))
      assert.notEqual(resposta.status, 401, `${metodo}: a chave válida foi recusada`)
      await esperarRegistros()
      const linhas = await db.select().from(apiAcessos).where(eq(apiAcessos.userAgent, ua))
      assert.equal(linhas.length, 1, `${metodo}: o registro não tem a linha desta chamada`)
      assert.equal(linhas[0].chaveId, chave.id, `${metodo}: a linha não leva a chave`)
      assert.equal(linhas[0].endpoint, endpoint, `${metodo}: o endpoint da linha não é o da rota`)
      const [contador] = await db.select({ total: sum(apiLimite.pedidos) }).from(apiLimite).where(eq(apiLimite.chaveId, chave.id))
      assert.equal(Number(contador.total), 1, `${metodo}: o contador da chave não somou 1`)
    }
  })
}
