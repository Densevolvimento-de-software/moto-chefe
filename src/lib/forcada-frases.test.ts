import { test } from 'node:test'
import assert from 'node:assert/strict'
import { frasesDaForcada, rotuloDoAlvoNaFrase } from './forcada-frases'

const UMA = { linhas: [{ valor: 1000, marcado: 600 }], cobre: 400 }

test('frasesDaForcada: quanto foi marcado, quanto este PIX cobre, e quem fica livre', () => {
  const f = frasesDaForcada(UMA, 'venda #31902', 'esta linha')
  assert.equal(f.caixa.replace(/\s/g, ' '), 'O pagamento PIX de R$ 1.000,00 da venda #31902 foi marcado como recebido com R$ 600,00. Este PIX cobre os R$ 400,00 que faltam.')
  assert.equal(f.dialogo.replace(/\s/g, ' '), 'O pagamento PIX de R$ 1.000,00 da venda #31902 deixa de estar marcado como recebido, e esta linha fica livre para vincular de novo.')
  assert.match(frasesDaForcada(UMA, 'NF 1234').dialogo, /e este PIX fica livre/)
})

test('frasesDaForcada: cobre só parte do que falta', () => {
  assert.match(frasesDaForcada({ linhas: [{ valor: 1000, marcado: 600 }], cobre: 250 }, 'OS #4').caixa.replace(/\s/g, ' '), /Este PIX cobre R\$ 250,00 dos R\$ 400,00 que faltam\./)
})

test('rotuloDoAlvoNaFrase: venda, OS e venda de peça como o chip da /conciliacao', () => {
  assert.deepEqual([rotuloDoAlvoNaFrase('moto', 1), rotuloDoAlvoNaFrase('os', 2), rotuloDoAlvoNaFrase('peca', 3)], ['venda #1', 'OS #2', 'PA #3'])
})
