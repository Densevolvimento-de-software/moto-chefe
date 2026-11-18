import { test } from 'node:test'
import assert from 'node:assert/strict'
import { bearerConfere, iguaisEmTempoConstante } from './tempo-constante'

test('textos iguais conferem', () => {
  assert.equal(iguaisEmTempoConstante('segredo-123', 'segredo-123'), true)
})

test('texto diferente do mesmo tamanho não confere', () => {
  assert.equal(iguaisEmTempoConstante('segredo-124', 'segredo-123'), false)
})

test('tamanho diferente não confere e não lança (o timingSafeEqual lançaria)', () => {
  assert.equal(iguaisEmTempoConstante('segredo', 'segredo-123'), false)
  assert.equal(iguaisEmTempoConstante('', 'segredo-123'), false)
})

test('mesmo número de letras e bytes diferentes (acento): não confere e não lança', () => {
  assert.equal(iguaisEmTempoConstante('ação', 'acao'), false)
})

test('Bearer: confere só com o prefixo e o segredo exato; sem header, sem prefixo ou outro tamanho, não', () => {
  assert.equal(bearerConfere('Bearer segredo-123', 'segredo-123'), true)
  assert.equal(bearerConfere(null, 'segredo-123'), false)
  assert.equal(bearerConfere('segredo-123', 'segredo-123'), false)
  assert.equal(bearerConfere('bearer segredo-123', 'segredo-123'), false)
  assert.equal(bearerConfere('Bearer segredo', 'segredo-123'), false)
})
