import { test } from 'node:test'
import assert from 'node:assert/strict'
import { rotuloCurtoDaLinha, rotuloDaLinha } from './conciliacao-cartao'

test('rótulo curto da linha na lista da conciliação', () => {
  assert.equal(rotuloCurtoDaLinha('credito', 3), 'Cré 3x')
  assert.equal(rotuloCurtoDaLinha('debito', 1), 'Déb')
  assert.equal(rotuloCurtoDaLinha('pix', 1), 'PIX')
})

test('rótulo da linha na sugestão do painel de pagamentos', () => {
  assert.equal(rotuloDaLinha('credito'), 'Crédito')
  assert.equal(rotuloDaLinha('debito'), 'Débito')
  assert.equal(rotuloDaLinha('pix'), 'PIX')
})
