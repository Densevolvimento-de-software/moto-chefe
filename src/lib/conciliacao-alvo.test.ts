import { test } from 'node:test'
import assert from 'node:assert/strict'
import { alvoValido } from './conciliacao-alvo'

const ID = '2c9d47e2-c479-42bf-9372-f7a34308299f'

test('venda de moto, venda de peça e OS com id uuid são alvos válidos', () => {
  for (const tipo of ['moto', 'peca', 'os']) assert.equal(alvoValido({ tipo, id: ID }), true, tipo)
})

test('tipo fora da lista, id que não é uuid ou alvo que não é objeto são inválidos', () => {
  for (const alvo of [
    { tipo: 'xyz', id: ID },
    { tipo: 'venda', id: ID },
    { tipo: 'moto', id: 'venda-1' },
    { tipo: 'moto', id: 42 },
    { tipo: 'moto' },
    null,
    'moto',
  ]) assert.equal(alvoValido(alvo), false, JSON.stringify(alvo))
})
