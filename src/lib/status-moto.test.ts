import { test } from 'node:test'
import assert from 'node:assert/strict'
import { STATUS_DE_ESTOQUE, STATUS_MOTO, rotuloDoStatus, statusDaLista } from './status-moto'

// Ordem do caminho da moto (#9, decisão do Luis): chega em transporte, vai para a caixa, é montada.
test('status de estoque na ordem da tela: Em transporte, Caixa, Montada, Garantia', () => {
  assert.deepEqual(STATUS_DE_ESTOQUE.map(s => [s.valor, s.rotulo]), [['em_transporte', 'Em transporte'], ['caixa', 'Caixa'], ['montada', 'Montada'], ['em_garantia', 'Garantia']])
})

test('a lista completa traz também a vendida, no fim', () => {
  assert.deepEqual(STATUS_MOTO.map(s => s.valor), ['em_transporte', 'caixa', 'montada', 'em_garantia', 'vendida'])
})

test('rótulos: os da lista, os legados e o próprio valor quando desconhecido', () => {
  assert.deepEqual(
    ['em_transporte', 'caixa', 'montada', 'em_garantia', 'vendida', 'faturada', 'disponivel', 'reservada', 'xyz'].map(rotuloDoStatus),
    ['Em transporte', 'Caixa', 'Montada', 'Garantia', 'Vendida', 'Caixa', 'Disponível', 'Reservada', 'xyz'],
  )
})

test('statusDaLista acha só os status da lista', () => {
  assert.equal(statusDaLista('montada')?.rotulo, 'Montada')
  assert.equal(statusDaLista('faturada'), null)
})

// O detalhe da moto mostra em pílula só o status que o protótipo v2 mudou (#9); os outros seguem no Badge.
test('só o selo de em transporte é pílula', () => {
  assert.deepEqual(STATUS_MOTO.filter(s => s.selo.pilula).map(s => s.valor), ['em_transporte'])
})
