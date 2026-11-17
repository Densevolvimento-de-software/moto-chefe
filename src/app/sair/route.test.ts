// Rota de sair (#901): POST que encerra a sessão e leva ao /login; formulário de outro site é recusado
// sem encerrar nada. Mock só na fronteira: o cliente do Supabase.
import { test, mock } from 'node:test'
import assert from 'node:assert/strict'
import { NextRequest } from 'next/server'

let saidas = 0
mock.module('@/lib/supabase/server', { namedExports: {
  createClient: async () => ({ auth: { signOut: async () => { saidas++; return { error: null } } } }),
} })

const sair = async (origem?: string) => {
  const { POST } = await import('./route')
  return POST(new NextRequest('http://localhost:3000/sair', { method: 'POST', headers: origem ? { origin: origem } : {} }))
}

test('do próprio MOVA: encerra a sessão e vai ao /login com 303', async () => {
  saidas = 0
  const r = await sair('http://localhost:3000')
  assert.equal(r.status, 303)
  assert.equal(new URL(r.headers.get('location')!).pathname, '/login')
  assert.equal(saidas, 1)
})

test('de outro site: 403 e a sessão continua', async () => {
  saidas = 0
  const r = await sair('https://outro-site.example')
  assert.equal(r.status, 403)
  assert.equal(saidas, 0)
})
