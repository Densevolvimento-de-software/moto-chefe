import { test } from 'node:test'
import assert from 'node:assert/strict'
import { linhaEstornada, rotuloCurtoDaLinha, rotuloDaLinha } from './conciliacao-cartao'

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

// #51 (PR6b): a tela esconde Vincular/Desvincular pela mesma regra com que o servidor recusa (cartao-status.ts).
test('linhaEstornada: só o status de estorno do Mercado Pago', () => {
  assert.equal(linhaEstornada('estornado'), true)
  for (const status of ['aprovado', 'approved', '']) assert.equal(linhaEstornada(status), false)
})
