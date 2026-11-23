import { test } from 'node:test'
import assert from 'node:assert/strict'
import { liquidoDoBruto } from './preco-minimo'
import { destaqueAvista12x, ehPadraoSimulador, lerTotal12x, linhasDoSimulador, usaValor12x } from './simulador-padrao'

test('à vista + 12x: o total digitado vira 12 parcelas, sem taxa', () => {
  const r = destaqueAvista12x(13990, 15600)
  assert.equal(r.pix, 13990)
  assert.equal(r.total12x, 15600)
  assert.equal(r.parcela12x, 1300)
  assert.equal(r.descontoPix, 10)
  assert.equal(r.economiaPix, 1610)
  assert.equal(r.pixAcimaDo12x, false)
})

test('parcela arredonda em centavos', () => {
  assert.equal(destaqueAvista12x(9000, 10000).parcela12x, 833.33)
})

test('modelo sem total em 12x mostra só o PIX', () => {
  const r = destaqueAvista12x(12990, null)
  assert.deepEqual([r.total12x, r.parcela12x, r.descontoPix, r.economiaPix, r.pixAcimaDo12x], [null, null, null, null, false])
})

test('12x igual ou abaixo do PIX: sem desconto e com aviso', () => {
  for (const t12 of [12990, 12000]) {
    const r = destaqueAvista12x(12990, t12)
    assert.equal(r.total12x, t12)
    assert.equal(r.descontoPix, null)
    assert.equal(r.economiaPix, null)
    assert.equal(r.pixAcimaDo12x, true)
  }
})

test('desconto que arredonda a 0% não aparece; a economia continua', () => {
  const r = destaqueAvista12x(15550, 15600)
  assert.equal(r.descontoPix, null)
  assert.equal(r.economiaPix, 50)
})

test('com frete: PIX + frete e 12x + frete em parcelas', () => {
  const r = destaqueAvista12x(13990, 15600, 168)
  assert.deepEqual(r.comFrete, { custo: 168, pix: 14158, parcela12x: 1314 })
})

test('com frete e sem 12x: só o PIX + frete', () => {
  assert.deepEqual(destaqueAvista12x(13990, null, 168).comFrete, { custo: 168, pix: 14158, parcela12x: null })
  assert.equal(destaqueAvista12x(13990, 15600).comFrete, null)
})

test('total em 12x digitado: vazio e zero são "sem 12x"', () => {
  for (const v of ['', '  ', '0', '0.00']) assert.equal(lerTotal12x(v), null, `"${v}"`)
  assert.equal(lerTotal12x('15600'), 15600)
  assert.equal(lerTotal12x('15600.50'), 15600.5)
})

test('total em 12x digitado: negativo ou texto é inválido', () => {
  for (const v of ['-1', 'abc', 'Infinity']) assert.equal(lerTotal12x(v), 'invalido', `"${v}"`)
})

test('só os dois padrões existem, e só o novo usa o valor em 12x', () => {
  assert.equal(ehPadraoSimulador('taxas'), true)
  assert.equal(ehPadraoSimulador('avista_12x'), true)
  assert.equal(ehPadraoSimulador('outro'), false)
  assert.equal(ehPadraoSimulador(undefined), false)
  assert.equal(usaValor12x('avista_12x'), true)
  assert.equal(usaValor12x('taxas'), false)
})

// #206 (decisão do Luis): o total é o valor exato da maquininha, valor ÷ (1 − taxa) ao centavo, e a parcela é o total ÷ n
// ao centavo (a maquininha acerta os centavos numa das parcelas). Antes, a parcela subia ao centavo e o total era
// parcela × n, alguns centavos acima do que a maquininha cobra.
test('simulador, maquininha: o total é o valor exato, valor ÷ (1 − taxa), e a parcela é o total ÷ n (#50, #206)', () => {
  // Para a loja ficar com 10.000 a 9%: 10.000 / 0,91 = 10.989,01; em 12, 915,75 (o total não é 12 × 915,75).
  assert.deepEqual(linhasDoSimulador({ '12': 0.09 }, 10000, 0, 'maquininha'), [
    { parcelas: 12, credito: 10989.01, parcela: 915.75 },
  ])
})

test('simulador, maquininha com entrada: a taxa incide só sobre o saldo', () => {
  // Saldo 8.000 / 0,91 = 8.791,21; em 12, 732,60.
  assert.deepEqual(linhasDoSimulador({ '12': 0.09 }, 10000, 2000, 'maquininha'), [
    { parcelas: 12, credito: 8791.21, parcela: 732.6 },
  ])
})

test('simulador, maquininha: cobrando o total, a loja recebe o mínimo ao centavo (como na maquininha, pode faltar meio centavo)', () => {
  // 13.990 a 14,99% em 21x: total 16.456,89, parcela 783,66. 10.000 a 9% em 12x: total 10.989,01, parcela 915,75.
  for (const [base, taxa, n, parcela, total] of [[13990, 0.1499, 21, 783.66, 16456.89], [10000, 0.09, 12, 915.75, 10989.01]]) {
    const [linha] = linhasDoSimulador({ [n]: taxa }, base, 0, 'maquininha')
    assert.deepEqual(linha, { parcelas: n, credito: total, parcela })
    assert.ok(Math.abs(liquidoDoBruto(linha.credito, taxa) - base) <= 0.01, `líquido de ${linha.credito} longe do mínimo ${base}`)
  }
})

// Diferença em centavos inteiros (comparar reais em ponto flutuante dá 0,0100000001 para 1 centavo).
const centavosDeDiferenca = (a: number, b: number) => Math.round(Math.abs(a - b) * 100)

test('simulador, maquininha: o exemplo de Teresina (21/11) fica a 1 centavo da maquininha; a regra antiga, a 3', () => {
  // R$ 5.800 em 10x a 10,0995% (a taxa cadastrada, 4 casas): 5.800 ÷ 0,899005 = 6.451,58, parcela 645,16. A maquininha
  // cobrou 6.451,57: a taxa dela tem mais casas que as 4 do cadastro. A regra antiga dava 6.451,60.
  assert.deepEqual(linhasDoSimulador({ '10': 0.100995 }, 5800, 0, 'maquininha'), [{ parcelas: 10, credito: 6451.58, parcela: 645.16 }])
  assert.ok(centavosDeDiferenca(6451.58, 6451.57) <= 1)
})

// Simulação da PagueVeloz de 18/11/2026: R$ 7.990, repasse de taxas e antecipação. A PagueVeloz não publica as taxas;
// as daqui saem de cada total do PDF (1 − 7.990 ÷ total), com 4 casas como no cadastro, e servem só de fixture.
const PAGUEVELOZ_7990: [parcelas: number, taxa: number, total: number, parcela: number][] = [
  [1, 0.032157, 8255.47, 8255.47], [2, 0.043055, 8349.49, 4174.75], [3, 0.049739, 8408.22, 2802.74],
  [4, 0.056743, 8470.65, 2117.66], [5, 0.063758, 8534.12, 1706.82], [6, 0.070568, 8596.65, 1432.78],
  [7, 0.079766, 8682.57, 1240.37], [8, 0.086998, 8751.35, 1093.92], [9, 0.093895, 8817.96, 979.77],
  [10, 0.100995, 8887.6, 888.76], [11, 0.10876, 8965.04, 815], [12, 0.11578, 9036.21, 753.02],
  [13, 0.121402, 9094.03, 699.54], [14, 0.128325, 9166.26, 654.73], [15, 0.135905, 9246.67, 616.44],
  [16, 0.143566, 9329.38, 583.09], [17, 0.150575, 9406.36, 553.32], [18, 0.158339, 9493.13, 527.4],
  [19, 0.16581, 9578.15, 504.11], [20, 0.173649, 9669.02, 483.45], [21, 0.18155, 9762.36, 464.87],
]

test('simulador, maquininha: os 21 parcelamentos e o débito do PDF da PagueVeloz (R$ 7.990)', () => {
  const linhas = linhasDoSimulador(Object.fromEntries(PAGUEVELOZ_7990.map(([n, taxa]) => [n, taxa])), 7990, 0, 'maquininha')
  for (const [n, , total, parcela] of PAGUEVELOZ_7990) {
    const linha = linhas.find(l => l.parcelas === n)!
    // 20x: nenhuma taxa de 4 casas dá 9.669,02 (17,3649% dá 9.669,01; 17,3650%, 9.669,03): a taxa real tem mais casas.
    // Só nele o total aceita 1 centavo de diferença; a parcela bate.
    if (n === 20) assert.ok(centavosDeDiferenca(linha.credito, total) <= 1, `20x: ${linha.credito} × ${total}`)
    else assert.equal(linha.credito, total, `${n}x`)
    assert.equal(linha.parcela, parcela, `${n}x parcela`)
  }
  // Débito: 7.990 ÷ (1 − 0,99%) = 8.069,89, à vista.
  assert.deepEqual(linhasDoSimulador({ '1': 0.0099 }, 7990, 0, 'maquininha'), [{ parcelas: 1, credito: 8069.89, parcela: 8069.89 }])
})

test('simulador, maquininha: parcela sem taxa ou com taxa de 100% ou mais não aparece', () => {
  const linhas = linhasDoSimulador({ '3': 0, '6': 1.2, '12': 0.09 }, 10000, 0, 'maquininha')
  assert.deepEqual(linhas.map(l => l.parcelas), [12])
})

test('simulador, financiamento: a taxa segue como acréscimo sobre o saldo, como antes do #50', () => {
  // Saldo 8.000: 12x a 20% = 9.600; 24x a 140% = 19.200 (acréscimo acima de 100% vale aqui).
  assert.deepEqual(linhasDoSimulador({ '24': 1.4, '12': 0.2 }, 10000, 2000, 'financiamento'), [
    { parcelas: 12, credito: 9600, parcela: 800 },
    { parcelas: 24, credito: 19200, parcela: 800 },
  ])
})
