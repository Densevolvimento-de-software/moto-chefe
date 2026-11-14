// O middleware ligado à regra do login da fábrica (#901): o papel vem do app_metadata do token.
// Mock só na fronteira: o cliente do Supabase (getClaims).
import { test, mock } from 'node:test'
import assert from 'node:assert/strict'
import { NextRequest } from 'next/server'

let claims: Record<string, unknown> | null = null
mock.module('@supabase/ssr', { namedExports: {
  createServerClient: () => ({ auth: { getClaims: async () => ({ data: claims ? { claims } : null }) } }),
} })

const fabrica = (extra: Record<string, unknown> = {}) => ({ sub: 'u1', app_metadata: { papel: 'fabrica' }, ...extra })
const pedir = async (metodo: string, caminho: string) => {
  const { middleware } = await import('./middleware')
  return middleware(new NextRequest(`http://localhost:3000${caminho}`, { method: metodo }))
}
const destino = (r: Response) => (r.headers.get('location') ? new URL(r.headers.get('location')!).pathname : null)
/** Seguiu para a página: 200 e sem redirecionar (um 403 também não tem location). */
const seguiu = (r: Response) => r.status === 200 && destino(r) === null

test('login da fábrica: lê o painel; outro endereço volta ao painel; POST fora do sair é recusado', async () => {
  claims = fabrica()
  assert.ok(seguiu(await pedir('GET', '/fabrica')))
  assert.equal(destino(await pedir('GET', '/dashboard')), '/fabrica')
  assert.equal((await pedir('POST', '/fabrica')).status, 403)
  assert.ok(seguiu(await pedir('POST', '/sair')))
})

test('login da fábrica com senha provisória: /trocar-senha volta ao painel, e o painel abre', async () => {
  claims = fabrica({ user_metadata: { must_change_password: true } })
  assert.equal(destino(await pedir('GET', '/trocar-senha')), '/fabrica')
  assert.ok(seguiu(await pedir('GET', '/fabrica')))
})

test('outro papel com senha provisória ainda consegue sair por POST', async () => {
  claims = { sub: 'u2', app_metadata: {}, user_metadata: { must_change_password: true } }
  assert.equal(destino(await pedir('GET', '/dashboard')), '/trocar-senha')
  assert.ok(seguiu(await pedir('POST', '/sair')))
})

test('sem o papel de fábrica no token, o middleware não prende em /fabrica', async () => {
  claims = { sub: 'u3', app_metadata: {} }
  assert.ok(seguiu(await pedir('GET', '/dashboard')))
  assert.ok(seguiu(await pedir('POST', '/dashboard')))
})
