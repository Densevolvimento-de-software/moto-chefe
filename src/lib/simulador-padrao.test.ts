import { test } from 'node:test'
import assert from 'node:assert/strict'
import { centavos } from './centavos'
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

test('simulador, maquininha: a parcela embute a taxa como % do bruto e o total é a soma das parcelas (#50)', () => {
  // Para a loja ficar com 10.000 a 9%: 10.000 / 0,91 = 10.989,01, em 12 de 915,76 (parcela para cima);
  // o total mostrado é 12 × 915,76 = 10.989,12.
  assert.deepEqual(linhasDoSimulador({ '12': 0.09 }, 10000, 0, 'maquininha'), [
    { parcelas: 12, credito: 10989.12, parcela: 915.76 },
  ])
})

test('simulador, maquininha com entrada: a taxa incide só sobre o saldo', () => {
  // Saldo 8.000 / 0,91 = 8.791,21, em 12 de 732,61 (parcela para cima); total 12 × 732,61 = 8.791,32.
  assert.deepEqual(linhasDoSimulador({ '12': 0.09 }, 10000, 2000, 'maquininha'), [
    { parcelas: 12, credito: 8791.32, parcela: 732.61 },
  ])
})

test('simulador, maquininha: total = parcela × n, e cobrando esse total a loja recebe o mínimo', () => {
  // 13.990 a 14,99% em 21x: parcela 783,67, total 16.457,07. 10.000 a 9% em 12x: parcela 915,76, total 10.989,12.
  for (const [base, taxa, n, parcela, total] of [[13990, 0.1499, 21, 783.67, 16457.07], [10000, 0.09, 12, 915.76, 10989.12]]) {
    const [linha] = linhasDoSimulador({ [n]: taxa }, base, 0, 'maquininha')
    assert.deepEqual(linha, { parcelas: n, credito: total, parcela })
    assert.equal(centavos(linha.parcela * n), linha.credito)
    assert.ok(liquidoDoBruto(linha.credito, taxa) >= base, `líquido de ${linha.credito} abaixo do mínimo ${base}`)
  }
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
