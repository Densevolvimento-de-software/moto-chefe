import { afterEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { cronAutorizado } from './cron-auth'

const SEGREDO = 'segredo-do-cron'
afterEach(() => { delete process.env.CRON_SECRET })

const pedido = (headers: Record<string, string> = {}) => new Request('http://localhost/api/cron/x', { headers })

test('o cron da Vercel (Authorization: Bearer) e a chamada manual (x-cron-secret) com o segredo passam', () => {
  process.env.CRON_SECRET = SEGREDO
  assert.equal(cronAutorizado(pedido({ authorization: `Bearer ${SEGREDO}` })), true)
  assert.equal(cronAutorizado(pedido({ 'x-cron-secret': SEGREDO })), true)
})

test('sem header, sem o prefixo Bearer, segredo errado ou de outro tamanho: recusa', () => {
  process.env.CRON_SECRET = SEGREDO
  assert.equal(cronAutorizado(pedido()), false)
  assert.equal(cronAutorizado(pedido({ authorization: SEGREDO })), false)
  assert.equal(cronAutorizado(pedido({ authorization: 'Bearer segredo-do-crom' })), false)
  assert.equal(cronAutorizado(pedido({ 'x-cron-secret': 'segredo-do-crom' })), false)
  assert.equal(cronAutorizado(pedido({ 'x-cron-secret': `${SEGREDO}-a-mais` })), false)
})

test('sem o segredo no servidor, nada passa, nem header vazio', () => {
  assert.equal(cronAutorizado(pedido({ authorization: 'Bearer undefined', 'x-cron-secret': 'undefined' })), false)
  process.env.CRON_SECRET = ''
  assert.equal(cronAutorizado(pedido({ authorization: 'Bearer ', 'x-cron-secret': '' })), false)
})
