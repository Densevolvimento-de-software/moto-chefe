// Quem categoriza as saídas do banco em /despesas (#149): a marca do cadastro, não o e-mail.
// Mock só na fronteira de fora (Supabase, Next, banco): a regra é a função de verdade.
import test, { mock } from 'node:test'
import assert from 'node:assert/strict'

mock.module('@/lib/supabase/server', { namedExports: { createClient: async () => ({}) } })
mock.module('@/lib/db', { namedExports: { db: {} } })
mock.module('next/navigation', { namedExports: { redirect: () => { throw new Error('redirect') } } })
mock.module('next/headers', { namedExports: { cookies: async () => ({ get: () => undefined }), headers: async () => new Headers() } })

const quem = (papel: string, categorizaDespesaBanco: boolean) => ({ papel, email: `${papel}@teste.invalid`, categorizaDespesaBanco })

test('sócio com a marca categoriza; sem a marca, não', async () => {
  const { podeCategorizarDespesaBanco } = await import('./auth')
  assert.equal(podeCategorizarDespesaBanco(quem('admin_socio', true)), true)
  assert.equal(podeCategorizarDespesaBanco(quem('admin_socio', false)), false)
})

test('guarda: admin_geral categoriza sempre; aux_adm e vendedor não, nem com a marca (admin de rede chega como sócio na sessão)', async () => {
  const { podeCategorizarDespesaBanco } = await import('./auth')
  assert.equal(podeCategorizarDespesaBanco(quem('admin_geral', false)), true)
  for (const papel of ['aux_adm', 'vendedor']) assert.equal(podeCategorizarDespesaBanco(quem(papel, true)), false, papel)
})
