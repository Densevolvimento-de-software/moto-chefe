import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  entradaMinimaPctDoCampo, fraseEntradaMinimaServidor, fraseEntradaMinimaTela, lerEntradaMinimaPct, lerEntradasMinimas,
  minimoDaEntrada, validarReserva,
} from './entrada-minima-reserva'
import { espacoComum } from '@/test/espaco-comum'

const PIX = 15000

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

test('a porcentagem é um número inteiro de 0 a 100; o resto é recusado', () => {
  assert.deepEqual([0, 30, 100].map(lerEntradaMinimaPct), [0, 30, 100])
  for (const ruim of [20.5, -1, 101, '20', null, undefined, NaN, Infinity, {}]) assert.equal(lerEntradaMinimaPct(ruim), null, String(ruim))
})

test('o campo da tela aceita só dígitos inteiros de 0 a 100, com espaço nas pontas', () => {
  assert.equal(entradaMinimaPctDoCampo('20'), 20)
  assert.equal(entradaMinimaPctDoCampo(' 20 '), 20)
  assert.equal(entradaMinimaPctDoCampo('0'), 0)
  for (const ruim of ['', '2,5', '2.5', '1e2', '101', '-1', 'abc', '020x']) assert.equal(entradaMinimaPctDoCampo(ruim), null, ruim)
})

const LOJA_1 = '11111111-1111-4111-8111-111111111111'
const LOJA_2 = '22222222-2222-4222-8222-222222222222'

test('o pedido vira só pares loja e porcentagem; campo a mais do navegador some', () => {
  const lido = lerEntradasMinimas([{ lojaId: LOJA_1, pct: 20, grupoId: 'outro', ativa: false }, { lojaId: LOJA_2, pct: 0 }])
  assert.deepEqual(lido, [{ lojaId: LOJA_1, pct: 20 }, { lojaId: LOJA_2, pct: 0 }])
})

test('pedido ilegível é recusado inteiro: vazio, sem lista, id que não é UUID, loja repetida, porcentagem ruim', () => {
  const ruins: unknown[] = [
    [], null, 'x', { lojaId: LOJA_1, pct: 20 },
    [{ lojaId: 'nao-e-uuid', pct: 20 }],
    [{ lojaId: LOJA_1, pct: 20 }, { lojaId: LOJA_1, pct: 10 }],
    [{ lojaId: LOJA_1, pct: 20 }, { lojaId: LOJA_2, pct: 20.5 }],
    [{ lojaId: LOJA_1, pct: '20' }],
    [null],
  ]
  for (const ruim of ruins) assert.equal(lerEntradasMinimas(ruim), null, JSON.stringify(ruim))
})
