import { test } from 'node:test'
import assert from 'node:assert/strict'
import { centavosParaCima } from './centavos'

test('centavosParaCima: qualquer fração de centavo sobe', () => {
  assert.equal(centavosParaCima(783.661), 783.67)
  assert.equal(centavosParaCima(915.7508), 915.76)
})

test('centavosParaCima: valor exato não sobe pelo resto de ponto flutuante', () => {
  assert.equal(centavosParaCima(800.0000000001), 800)
  assert.equal(centavosParaCima(0.1 + 0.2), 0.3)
  assert.equal(centavosParaCima(9600 / 12), 800)
})
