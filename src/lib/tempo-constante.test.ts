import { test } from 'node:test'
import assert from 'node:assert/strict'
import { iguaisEmTempoConstante } from './tempo-constante'

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
