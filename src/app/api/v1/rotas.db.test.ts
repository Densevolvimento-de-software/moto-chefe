// Teste de banco: toda rota de src/app/api/v1 passa pela casca de chave (#320, roteiro E1 e E2).
// A lista vem do disco, para rota nova entrar sozinha. E1 confere o texto do arquivo (chama comChaveDaApi);
// E2 confere o comportamento (sem Authorization, cada método recusa com a mesma frase). Os dois juntos não
// provam a ordem da casca: a ordem é do teste da rota de lojas.
import { before, test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { NextRequest } from 'next/server'
import { mockAfterDaResposta } from '@/test/after-resposta'

const url = process.env.TEST_DATABASE_URL
if (!url) throw new Error('TEST_DATABASE_URL não definida — este teste só roda num Postgres descartável')
if (!['localhost', '127.0.0.1'].includes(new URL(url).hostname)) {
  throw new Error('TEST_DATABASE_URL precisa ser loopback (Postgres descartável)')
}
process.env.DATABASE_URL = url

const RAIZ = join(process.cwd(), 'src/app/api/v1')
const METODOS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const
const ROTAS = readdirSync(RAIZ, { recursive: true, encoding: 'utf8' }).filter(caminho => caminho.split(sep).pop() === 'route.ts')

before(async () => {
  await mockAfterDaResposta()
})

test('há pelo menos uma rota em src/app/api/v1 para conferir', () => {
  assert.ok(ROTAS.length > 0)
})

for (const arquivo of ROTAS) {
  test(`${arquivo}: chama a casca comChaveDaApi`, () => {
    assert.match(readFileSync(join(RAIZ, arquivo), 'utf8'), /comChaveDaApi\(/)
  })
}

for (const arquivo of ROTAS) {
  test(`${arquivo}: sem Authorization, cada método exportado recusa com acesso negado`, async () => {
    const modulo = await import(pathToFileURL(join(RAIZ, arquivo)).href)
    const exportados = METODOS.filter(metodo => typeof modulo[metodo] === 'function')
    assert.ok(exportados.length > 0, 'rota sem nenhum método exportado')
    for (const metodo of exportados) {
      const resposta: Response = await modulo[metodo](new NextRequest('http://localhost/api/v1/teste', { method: metodo }))
      assert.equal(resposta.status, 401, metodo)
      assert.deepEqual(await resposta.json(), { codigo: 'acesso_negado', frase: 'Acesso negado.' }, metodo)
    }
  })
}
