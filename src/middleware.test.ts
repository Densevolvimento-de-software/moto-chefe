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

test('login da fábrica: lê o painel; outro endereço volta ao painel; POST fora do sair é recusado', async () => {
  claims = fabrica()
  assert.equal(destino(await pedir('GET', '/fabrica')), null)
  assert.equal(destino(await pedir('GET', '/dashboard')), '/fabrica')
  assert.equal((await pedir('POST', '/fabrica')).status, 403)
  assert.equal(destino(await pedir('POST', '/sair')), null)
})

test('login da fábrica com senha provisória não vai à troca de senha: volta ao painel (a fábrica não troca a própria)', async () => {
  claims = fabrica({ user_metadata: { must_change_password: true } })
  assert.equal(destino(await pedir('GET', '/trocar-senha')), '/fabrica')
  assert.equal(destino(await pedir('GET', '/fabrica')), null)
})

test('outro papel com senha provisória ainda consegue sair por POST', async () => {
  claims = { sub: 'u2', app_metadata: {}, user_metadata: { must_change_password: true } }
  assert.equal(destino(await pedir('GET', '/dashboard')), '/trocar-senha')
  assert.equal(destino(await pedir('POST', '/sair')), null)
})

test('sem o papel de fábrica no token, o middleware não prende em /fabrica', async () => {
  claims = { sub: 'u3', app_metadata: {} }
  assert.equal(destino(await pedir('GET', '/dashboard')), null)
  assert.equal((await pedir('POST', '/dashboard')).status, 200)
})
