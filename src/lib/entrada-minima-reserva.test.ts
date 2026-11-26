import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fraseEntradaMinimaServidor, fraseEntradaMinimaTela, minimoDaEntrada, validarReserva } from './entrada-minima-reserva'

const PIX = 15000
// O Intl separa "R$" do valor com espaço sem quebra; a frase da tela é a mesma com espaço comum.
const espacoComum = (t: string) => t.replace(/\u00a0/g, ' ')

test('o mínimo é a porcentagem da loja sobre o preço PIX: 20% de R$ 15.000,00 dá R$ 3.000,00', () => {
  assert.equal(minimoDaEntrada(PIX, 20), 3000)
  assert.equal(minimoDaEntrada(PIX, 30), 4500)
})

test('0% não tem mínimo: qualquer entrada passa', () => {
  assert.equal(minimoDaEntrada(PIX, 0), 0)
  assert.equal(validarReserva(0.01, 20000, PIX, 0).entradaOk, true)
})

test('100% exige o preço PIX inteiro', () => {
  assert.equal(minimoDaEntrada(PIX, 100), PIX)
  assert.equal(validarReserva(14000, 20000, PIX, 100).entradaOk, false)
  assert.equal(validarReserva(15000, 20000, PIX, 100).entradaOk, true)
})

test('a folga de um centavo continua: 2.999,99 passa em 20%, 2.999,98 não', () => {
  assert.equal(validarReserva(2999.99, 20000, PIX, 20).entradaOk, true)
  assert.equal(validarReserva(2999.98, 20000, PIX, 20).entradaOk, false)
})

test('devolve o mínimo da loja para a tela e o servidor mostrarem o mesmo número', () => {
  assert.equal(validarReserva(1000, 20000, PIX, 20).minimoEntrada, 3000)
})

test('o aviso do valor total não depende da porcentagem: total abaixo do PIX segue só como aviso', () => {
  const r = validarReserva(3000, 14000, PIX, 20)
  assert.equal(r.totalOk, false)
  assert.equal(r.entradaOk, true)
  assert.equal(validarReserva(3000, 14000, PIX, 0).totalOk, false)
})

test('as duas frases levam a porcentagem da loja', () => {
  assert.equal(espacoComum(fraseEntradaMinimaServidor(3000, 20, PIX)), 'Entrada mínima de R$ 3.000,00 (20% do preço PIX R$ 15.000,00)')
  assert.equal(espacoComum(fraseEntradaMinimaTela(3000, 20)), 'Mínimo de R$ 3.000,00 (20% do preço PIX)')
})
