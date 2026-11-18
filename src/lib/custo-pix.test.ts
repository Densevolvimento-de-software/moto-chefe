// Custo do PIX (#89): o banco credita o valor do PIX menos a porcentagem do grupo.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { creditoDoPix, custoDoPixRecebido, lerCustoPixTaxa } from './custo-pix'

test('crédito de R$ 9.980,00 com 0,20%: o PIX foi de R$ 10.000,00 e custou R$ 20,00', () => {
  assert.deepEqual(custoDoPixRecebido(9980, 0.002), { bruto: 10000, custo: 20 })
})

test('PIX de R$ 10.000,00 com 0,20%: custa R$ 20,00 e entram R$ 9.980,00', () => {
  assert.deepEqual(creditoDoPix(10000, 0.002), { custo: 20, entra: 9980 })
})

test('custo 0: o PIX entra inteiro', () => {
  assert.deepEqual(custoDoPixRecebido(9980, 0), { bruto: 9980, custo: 0 })
  assert.deepEqual(creditoDoPix(10000, 0), { custo: 0, entra: 10000 })
})

test('valores quebrados arredondam ao centavo', () => {
  // 1.234,56 ÷ 0,998 = 1.237,0341...; 333,33 × 0,9985 = 332,830005
  assert.deepEqual(custoDoPixRecebido(1234.56, 0.002), { bruto: 1237.03, custo: 2.47 })
  assert.deepEqual(creditoDoPix(333.33, 0.0015), { custo: 0.5, entra: 332.83 })
})

test('lerCustoPixTaxa: aceita de 0 até menos de 100%', () => {
  assert.equal(lerCustoPixTaxa('0'), 0)
  assert.equal(lerCustoPixTaxa('0.002'), 0.002)
  assert.equal(lerCustoPixTaxa('0.999999'), 0.999999)
  assert.equal(lerCustoPixTaxa(0.002), 0.002)
})

test('lerCustoPixTaxa: recusa 100% ou mais, negativo, vazio e o que não é número', () => {
  for (const v of ['1', '1.5', '-0.001', '', ' ', 'abc', 'Infinity', NaN, null, undefined, {}, ['0.002']]) {
    assert.equal(lerCustoPixTaxa(v), null, String(v))
  }
})

test('lerCustoPixTaxa: arredonda às 6 casas do banco antes de conferir a faixa', () => {
  // 0,14% digitado vira 0.14 / 100 = 0.0014000000000000002 no ponto flutuante
  assert.equal(lerCustoPixTaxa(String(0.14 / 100)), 0.0014)
  // o banco gravaria 1.000000, que a check da coluna recusa
  assert.equal(lerCustoPixTaxa('0.9999999'), null)
})

test('taxa de 100% ou mais não tem valor do PIX que pague: fica sem custo', () => {
  assert.deepEqual(custoDoPixRecebido(9980, 1), { bruto: 9980, custo: 0 })
  assert.deepEqual(custoDoPixRecebido(9980, 1.5), { bruto: 9980, custo: 0 })
})
