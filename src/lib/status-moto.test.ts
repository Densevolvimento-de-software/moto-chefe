import { test } from 'node:test'
import assert from 'node:assert/strict'
import { STATUS_DE_ESTOQUE, STATUS_MOTO, rotuloDoStatus, statusDaLista } from './status-moto'

test('status de estoque na ordem da tela: Caixa, Montada, Garantia', () => {
  assert.deepEqual(STATUS_DE_ESTOQUE.map(s => [s.valor, s.rotulo]), [['caixa', 'Caixa'], ['montada', 'Montada'], ['em_garantia', 'Garantia']])
})

test('a lista completa traz também a vendida, no fim', () => {
  assert.deepEqual(STATUS_MOTO.map(s => s.valor), ['caixa', 'montada', 'em_garantia', 'vendida'])
})

test('rótulos: os da lista, os legados e o próprio valor quando desconhecido', () => {
  assert.deepEqual(
    ['caixa', 'montada', 'em_garantia', 'vendida', 'faturada', 'disponivel', 'reservada', 'xyz'].map(rotuloDoStatus),
    ['Caixa', 'Montada', 'Garantia', 'Vendida', 'Caixa', 'Disponível', 'Reservada', 'xyz'],
  )
})

test('statusDaLista acha só os status da lista', () => {
  assert.equal(statusDaLista('montada')?.rotulo, 'Montada')
  assert.equal(statusDaLista('faturada'), null)
})
