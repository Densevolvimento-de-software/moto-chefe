// Conferência das motos da Entrada (#691): o que entra e a recusa de cada uma, na ordem da lista.
import test from 'node:test'
import assert from 'node:assert/strict'
import { comoEntraram, separarMotosDaEntrada, statusNaEntrada } from './entrada-motos-regras'

const moto = (chassi: string, modeloId = 'm1', precoCompra = '6400,50') => ({ chassi, cor: 'CINZA', modeloId, precoCompra, notaFiscal: '9901' })

test('normaliza o chassi e o preço e separa a moto pronta', () => {
  const r = separarMotosDaEntrada([moto(' abc123 ')], new Set(['m1']))
  assert.deepEqual(r, { prontas: [{ chassi: 'ABC123', moto: moto(' abc123 '), precoCompra: '6400.50' }], erros: [] })
})

test('recusa repetido, modelo fora da Conta e preço vazio, na ordem da lista; chassi vazio é ignorado', () => {
  const r = separarMotosDaEntrada([moto('A1'), moto('a1'), moto('B1', 'de-outra-conta'), moto('C1', 'm1', ' '), moto('  '), moto('D1', '')], new Set(['m1']))
  assert.deepEqual(r.prontas.map(p => p.chassi), ['A1'])
  assert.deepEqual(r.erros, [
    'A1: chassi repetido na nota',
    'B1: selecione o modelo antes de registrar',
    'C1: informe o preço de compra',
    'D1: selecione o modelo antes de registrar',
  ])
})

// Status na entrada (#10): o valor vem do navegador; só Caixa e Em transporte entram.
test('status na entrada aceita só caixa e em_transporte', () => {
  assert.equal(statusNaEntrada('caixa'), 'caixa')
  assert.equal(statusNaEntrada('em_transporte'), 'em_transporte')
  for (const forjado of ['vendida', 'montada', 'em_garantia', 'xyz', '', 'CAIXA', null, 1, {}]) {
    assert.equal(statusNaEntrada(forjado), null, `aceitou ${JSON.stringify(forjado)}`)
  }
})

test('status na entrada ausente vale Caixa (pedido de uma tela aberta antes do campo existir)', () => {
  assert.equal(statusNaEntrada(undefined), 'caixa')
})

test('a frase de sucesso diz só o Em transporte', () => {
  assert.equal(comoEntraram('em_transporte'), ' como Em transporte')
  assert.equal(comoEntraram('caixa'), '')
})
