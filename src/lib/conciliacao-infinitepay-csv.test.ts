import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseInfinityPay } from './conciliacao-infinitepay-csv'
import { detectarFormato } from './conciliacao-formato'
import { cartaoInfinitePay, montarRelatorioInfinitePay, pixInfinitePay } from '@/test/relatorio-infinitepay-sintetico'

const ler = (...linhas: Record<string, string>[]) => parseInfinityPay(montarRelatorioInfinitePay(linhas))

test('linha Pix aprovada vira linha pix com valor, líquido, data, NSU, bandeira e portador', () => {
  const [linha, ...resto] = ler(pixInfinitePay({ 'Data e hora': '12/11/2026 09:30', 'Valor (R$)': '250,50', 'Líquido (R$)': '250,50' }))
  assert.equal(resto.length, 0)
  assert.equal(linha.tipo, 'pix')
  assert.equal(linha.dataTransacao, '2026-11-12')
  assert.equal(linha.valorBruto, 250.5)
  assert.equal(linha.valorLiquido, 250.5)
  assert.equal(linha.parcelas, 1)
  assert.equal(linha.nsu, '7000000001')
  assert.equal(linha.bandeira, 'Pix')
  assert.equal(linha.portador, 'PAGADOR FICTICIO DOIS')
})

test('o relatório de PIX é reconhecido como InfinitePay pelo cabeçalho', () => {
  assert.equal(detectarFormato(montarRelatorioInfinitePay([pixInfinitePay()])), 'infinitypay')
})

test('Pix negada fica de fora (sem vermelho: o filtro de status já valia)', () => {
  assert.deepEqual(ler(pixInfinitePay({ 'Status': 'Negada' })), [])
})

test('meio desconhecido segue de fora (sem vermelho: já valia)', () => {
  assert.deepEqual(ler(pixInfinitePay({ 'Meio - Meio': 'Outro meio' })), [])
})

test('crédito à vista, crédito parcelado e débito saem como antes (sem vermelho: já valia)', () => {
  const linhas = ler(
    cartaoInfinitePay(),
    cartaoInfinitePay({ 'Meio - Parcelas': '3x', 'Valor (R$)': '300,00', 'Líquido (R$)': '290,00', 'NSU': 'S2' }),
    cartaoInfinitePay({ 'Meio - Meio': 'Débito', 'NSU': 'S3' }),
  )
  assert.deepEqual(linhas.map(l => [l.tipo, l.parcelas, l.valorBruto, l.valorLiquido]), [
    ['credito', 1, 100, 97], ['credito', 3, 300, 290], ['debito', 1, 100, 97],
  ])
  assert.equal(linhas[0].terminal, 'TESTE000000001')
})

test('arquivo misto: cartão e PIX do mesmo valor no mesmo dia saem como duas linhas de tipos diferentes', () => {
  const linhas = ler(cartaoInfinitePay(), pixInfinitePay())
  assert.deepEqual(linhas.map(l => l.tipo), ['credito', 'pix'])
  assert.notEqual(linhas[0].nsu, linhas[1].nsu)
})
