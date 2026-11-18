import { afterEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { tokenValido } from './jarvis-auth'

const TOKEN = 'token-do-jarvis'
afterEach(() => { delete process.env.JARVIS_API_TOKEN })

test('Bearer com o token configurado passa', () => {
  process.env.JARVIS_API_TOKEN = TOKEN
  assert.equal(tokenValido(`Bearer ${TOKEN}`), true)
})

test('sem header, sem o prefixo Bearer, token errado ou de outro tamanho: recusa', () => {
  process.env.JARVIS_API_TOKEN = TOKEN
  assert.equal(tokenValido(null), false)
  assert.equal(tokenValido(TOKEN), false)
  assert.equal(tokenValido('Bearer token-do-jarviz'), false)
  assert.equal(tokenValido('Bearer curto'), false)
})

test('sem o token no servidor, nada passa', () => {
  assert.equal(tokenValido('Bearer '), false)
  assert.equal(tokenValido(`Bearer ${TOKEN}`), false)
})
