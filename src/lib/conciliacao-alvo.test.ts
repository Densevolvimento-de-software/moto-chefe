import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ALVO_TIPOS, alvoDasColunas, alvoValido, colunasDoAlvo, semAlvos, tipoDoAlvo } from './conciliacao-alvo'

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

test('tipoDoAlvo: tipo da lista vale, inclusive com id inválido; fora da lista ou sem tipo vira venda de moto', () => {
  assert.equal(tipoDoAlvo({ tipo: 'os', id: 'os-1' }), 'os')
  assert.equal(tipoDoAlvo({ tipo: 'peca', id: ID }), 'peca')
  for (const alvo of [{ tipo: 'xyz', id: ID }, { id: ID }, null, 'os']) assert.equal(tipoDoAlvo(alvo), 'moto', JSON.stringify(alvo))
})

test('colunasDoAlvo: só a coluna do tipo leva o id; as outras ficam nulas', () => {
  assert.deepEqual(colunasDoAlvo({ tipo: 'moto', id: ID }), { vendaId: ID, pecaVendaId: null, osId: null })
  assert.deepEqual(colunasDoAlvo({ tipo: 'peca', id: ID }), { vendaId: null, pecaVendaId: ID, osId: null })
  assert.deepEqual(colunasDoAlvo({ tipo: 'os', id: ID }), { vendaId: null, pecaVendaId: null, osId: ID })
})

test('alvoDasColunas: o inverso de colunasDoAlvo; sem coluna preenchida, null', () => {
  for (const tipo of ALVO_TIPOS) {
    const alvo = { tipo, id: ID }
    assert.deepEqual(alvoDasColunas(colunasDoAlvo(alvo)), alvo)
  }
  assert.equal(alvoDasColunas(semAlvos()), null)
})
