// Custo do PIX (#89): o banco credita o valor do PIX menos a porcentagem do grupo.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { avisoDeCustoAlto, creditoDoPix, custoDoPixForcado, esperadoComTaxa, custoDoPixRecebido, custoDoPixVinculado, custoPixDoCampo, lerCustoPixTaxa, lerValorRecebido, percentualDoPix } from './custo-pix'

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

test('custoPixDoCampo: o texto do campo, em %, vira a fração; vazio vale 0', () => {
  assert.equal(custoPixDoCampo(''), 0)
  assert.equal(custoPixDoCampo('  '), 0)
  assert.equal(custoPixDoCampo('0,20'), 0.002)
  assert.equal(custoPixDoCampo('0.2'), 0.002)
  assert.equal(custoPixDoCampo('99,99'), 0.9999)
})

// #108: '0.020' era lido como milhar (20%).
test('custoPixDoCampo: ponto decimal com zero à esquerda não vira milhar', () => {
  assert.equal(custoPixDoCampo('0.020'), 0.0002)
  assert.equal(custoPixDoCampo('0.200'), 0.002)
})

test('custoPixDoCampo: ilegível ou fora da faixa é null', () => {
  for (const texto of ['abc', '0,2%', '100', '1.000', '-1']) assert.equal(custoPixDoCampo(texto), null, texto)
})

// #90: o que se grava no PIX recebido ao vincular. Só PIX tem custo; TED e linha antiga sem tipo entram inteiras.
test('custoDoPixVinculado: PIX creditado R$ 9.980,00 com 0,20% grava bruto R$ 10.000,00, custo R$ 20,00 e a taxa', () => {
  assert.deepEqual(custoDoPixVinculado('PIX', 9980, 0.002), { valorBruto: 10000, custoPix: 20, custoPixTaxa: 0.002 })
})

test('custoDoPixVinculado: TED, linha sem tipo e grupo sem custo gravam o crédito inteiro, custo 0 e taxa 0', () => {
  for (const [tipo, taxa] of [['TED', 0.002], [null, 0.002], ['PIX', 0]] as const) {
    assert.deepEqual(custoDoPixVinculado(tipo, 9980, taxa), { valorBruto: 9980, custoPix: 0, custoPixTaxa: 0 }, `${tipo} ${taxa}`)
  }
})

// #92: forçada de PIX. Decisão do Luis registrada na #92: custo = o que o pagamento esperava − o que entrou, nunca negativo.
test('lerValorRecebido: número positivo em centavos; o resto é null', () => {
  assert.equal(lerValorRecebido(9980), 9980)
  assert.equal(lerValorRecebido(9970.015), 9970.02)
  for (const v of [0, -1, 0.004, NaN, Infinity, '9980', null, undefined, {}]) assert.equal(lerValorRecebido(v), null, String(v))
})

test('custoDoPixForcado: custo é a base menos o que entrou; a taxa é a efetiva', () => {
  assert.deepEqual(custoDoPixForcado(10000, 9980), { valorBruto: 10000, custoPix: 20, custoPixTaxa: 0.002 })
  assert.deepEqual(custoDoPixForcado(10000, 9970.02), { valorBruto: 10000, custoPix: 29.98, custoPixTaxa: 0.002998 })
})

test('custoDoPixForcado: entrou o valor cheio ou mais, custo 0', () => {
  assert.deepEqual(custoDoPixForcado(10000, 10000), { valorBruto: 10000, custoPix: 0, custoPixTaxa: 0 })
  assert.deepEqual(custoDoPixForcado(10000, 10050), { valorBruto: 10000, custoPix: 0, custoPixTaxa: 0 })
})

test('esperadoComTaxa: o crédito esperado com custo; sem custo, nenhum', () => {
  assert.equal(esperadoComTaxa(10000, 0.002), 9980)
  assert.equal(esperadoComTaxa(600, 0.002), 598.8)
  assert.equal(esperadoComTaxa(10000, 0), null)
})

// #92, decisão do Luis registrada na #92: custo da forçada acima de 1% do pagamento avisa (não bloqueia).
test('avisoDeCustoAlto: acima de 1% avisa com o custo e o do grupo; até 1% não avisa', () => {
  assert.equal(avisoDeCustoAlto(custoDoPixForcado(10000, 5990), 0.002),
    'Custo de 40,10% bem acima do custo do PIX do grupo (0,20%). Confira o valor que entrou.')
  assert.equal(avisoDeCustoAlto(custoDoPixForcado(10000, 9900), 0.002), null, 'exatamente 1%')
  assert.equal(avisoDeCustoAlto(custoDoPixForcado(10000, 9899), 0), 'Custo de 1,01% bem acima do custo do PIX do grupo (0,00%). Confira o valor que entrou.')
  assert.equal(avisoDeCustoAlto(custoDoPixForcado(10000, 9980), 0.002), null)
})

test('percentualDoPix: duas a quatro casas, vírgula', () => {
  assert.deepEqual([0.002, 0.002998, 0.401].map(percentualDoPix), ['0,20%', '0,2998%', '40,10%'])
})
