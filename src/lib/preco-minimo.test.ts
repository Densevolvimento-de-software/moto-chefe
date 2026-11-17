import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  brutoParaReceber, calcLiquidoRecebido, liquidoDoBruto, parcelasComTaxa, validarPrecoVenda, type TaxasVenda,
} from './preco-minimo'

// Taxas no formato do banco (configuracao_taxas): fração, não percentual.
const TAXAS: TaxasVenda = {
  taxasCartao: { '1': 0.0399, '8': 0.0916, '12': 0.09 },
  taxasDebito: { '1': 0.0139 },
  taxasLink: { '12': 0.09 },
  taxasFinanciamento: { '1': 0.05 },
}

test('pix, dinheiro e transferência entram integrais — não têm taxa', () => {
  assert.equal(calcLiquidoRecebido([{ tipo: 'pix', valor: 10490 }], TAXAS), 10490)
  assert.equal(calcLiquidoRecebido([{ tipo: 'dinheiro', valor: 500 }], TAXAS), 500)
  assert.equal(calcLiquidoRecebido([{ tipo: 'transferencia', valor: 8000 }], TAXAS), 8000)
})

test('cartão de crédito: a taxa é % do bruto, o líquido é bruto × (1 − taxa)', () => {
  // Exemplo do #50: 10.900 em 12x a 9% deixa 9.919 para a loja (não 10.900 / 1,09 = 10.000).
  assert.equal(calcLiquidoRecebido([{ tipo: 'cartao_credito', valor: 10900, parcelas: 12 }], TAXAS), 9919)
})

test('link de pagamento desconta a taxa do mesmo jeito', () => {
  assert.equal(calcLiquidoRecebido([{ tipo: 'link_pagamento', valor: 10900, parcelas: 12 }], TAXAS), 9919)
})

test('cada parcela usa a sua própria taxa', () => {
  const um = calcLiquidoRecebido([{ tipo: 'cartao_credito', valor: 10000, parcelas: 1 }], TAXAS)
  const doze = calcLiquidoRecebido([{ tipo: 'cartao_credito', valor: 10000, parcelas: 12 }], TAXAS)
  assert.ok(um > doze)
})

test('débito usa sempre a taxa de 1x, mesmo sem parcelas informadas', () => {
  // 1.000 × (1 − 1,39%) = 986,10
  assert.equal(calcLiquidoRecebido([{ tipo: 'cartao_debito', valor: 1000 }], TAXAS), 986.1)
})

test('parcela sem taxa cadastrada passa integral em vez de zerar', () => {
  // 6x não está na tabela: melhor creditar o bruto do que inventar desconto.
  assert.equal(calcLiquidoRecebido([{ tipo: 'cartao_credito', valor: 5000, parcelas: 6 }], TAXAS), 5000)
})

test('cartão sem parcelas vira 0 — é o gatilho do aviso, não um líquido de verdade', () => {
  assert.equal(calcLiquidoRecebido([{ tipo: 'cartao_credito', valor: 9990 }], TAXAS), 0)
  assert.equal(calcLiquidoRecebido([{ tipo: 'link_pagamento', valor: 9990 }], TAXAS), 0)
})

test('financiamento não tem taxa — está no conjunto SEM_TAXA', () => {
  // A taxa de financiamento existe na configuração, mas o tipo sai antes de chegar nela.
  assert.equal(calcLiquidoRecebido([{ tipo: 'financiamento', valor: 12000, parcelas: 1 }], TAXAS), 12000)
})

test('pagamento misto soma o líquido de cada parte', () => {
  const pagamentos = [
    { tipo: 'dinheiro', valor: 2000 },
    { tipo: 'cartao_credito', valor: 6634.88, parcelas: 8 },
  ]
  // 2.000 + 6.634,88 × (1 − 9,16%) = 2.000 + 6.027,12, em centavos
  assert.equal(calcLiquidoRecebido(pagamentos, TAXAS), 8027.12)
})

test('validarPrecoVenda: déficit é o que falta pro mínimo — o desconto que será gravado', () => {
  const r = validarPrecoVenda([{ tipo: 'pix', valor: 9990 }], 10490, TAXAS)
  assert.equal(r.valido, false)
  assert.equal(r.liquido, 9990)
  assert.equal(r.deficit, 500)
})

test('validarPrecoVenda: venda no mínimo passa e não gera déficit', () => {
  const r = validarPrecoVenda([{ tipo: 'pix', valor: 10490 }], 10490, TAXAS)
  assert.equal(r.valido, true)
  assert.equal(r.deficit, 0)
})

test('validarPrecoVenda: acima do mínimo o déficit não fica negativo', () => {
  const r = validarPrecoVenda([{ tipo: 'pix', valor: 12000 }], 10490, TAXAS)
  assert.equal(r.valido, true)
  assert.equal(r.deficit, 0)
})

test('validarPrecoVenda: cartão pode reprovar mesmo com bruto acima do mínimo', () => {
  // 10.900 em 12x a 9% passa do mínimo de 10.000 no bruto, mas deixa 9.919: faltam 81.
  const r = validarPrecoVenda([{ tipo: 'cartao_credito', valor: 10900, parcelas: 12 }], 10000, TAXAS)
  assert.equal(r.valido, false)
  assert.equal(r.liquido, 9919)
  assert.equal(r.deficit, 81)
})

test('validarPrecoVenda: o bruto que embute a taxa (10.000 / 0,91 = 10.989,01) passa no mínimo', () => {
  const r = validarPrecoVenda([{ tipo: 'cartao_credito', valor: 10989.01, parcelas: 12 }], 10000, TAXAS)
  assert.equal(r.valido, true)
  assert.equal(r.liquido, 10000)
})

test('taxa de 100% ou mais zera o líquido: a venda cai no mínimo e pede aprovação', () => {
  const taxas = { ...TAXAS, taxasCartao: { '12': 1 }, taxasLink: { '12': 1.5 } }
  assert.equal(calcLiquidoRecebido([{ tipo: 'cartao_credito', valor: 10000, parcelas: 12 }], taxas), 0)
  assert.equal(calcLiquidoRecebido([{ tipo: 'link_pagamento', valor: 10000, parcelas: 12 }], taxas), 0)
})

test('taxa negativa não aumenta o líquido', () => {
  const taxas = { ...TAXAS, taxasCartao: { '12': -0.05 } }
  assert.equal(calcLiquidoRecebido([{ tipo: 'cartao_credito', valor: 10000, parcelas: 12 }], taxas), 10000)
})

test('parcelasComTaxa: as parcelas dos pagamentos parcelados que pagam taxa', () => {
  assert.deepEqual(parcelasComTaxa([{ tipo: 'cartao_credito', valor: 9950, parcelas: 12 }]), [12])
  assert.deepEqual(parcelasComTaxa([{ tipo: 'link_pagamento', valor: 9950, parcelas: 6 }]), [6])
})

test('parcelasComTaxa: à vista, débito, financiamento e crédito em 1x não têm parcelas a mostrar', () => {
  assert.deepEqual(parcelasComTaxa([
    { tipo: 'pix', valor: 1000 },
    { tipo: 'cartao_debito', valor: 1000, parcelas: 1 },
    { tipo: 'financiamento', valor: 1000, parcelas: 48 },
    { tipo: 'cartao_credito', valor: 1000, parcelas: 1 },
  ]), [])
})

test('parcelasComTaxa: N diferentes saem em ordem e sem repetir', () => {
  assert.deepEqual(parcelasComTaxa([
    { tipo: 'link_pagamento', valor: 3000, parcelas: 12 },
    { tipo: 'cartao_credito', valor: 3000, parcelas: 6 },
    { tipo: 'cartao_credito', valor: 3000, parcelas: 12 },
  ]), [6, 12])
})

test('brutoParaReceber: exemplo do #50, para receber 10.000 a 9% cobra-se 10.989,01', () => {
  assert.equal(brutoParaReceber(10000, 0.09), 10989.01)
})

test('liquidoDoBruto: 10.900 a 9% deixa 9.919', () => {
  assert.equal(liquidoDoBruto(10900, 0.09), 9919)
})

test('cobrar o bruto calculado devolve o líquido pedido, em centavos', () => {
  assert.equal(liquidoDoBruto(brutoParaReceber(10000, 0.09)!, 0.09), 10000)
})

test('taxa de 100% ou mais: não há bruto que pague, e o líquido é 0', () => {
  assert.equal(brutoParaReceber(1000, 1), null)
  assert.equal(brutoParaReceber(1000, 1.5), null)
  assert.equal(liquidoDoBruto(1000, 1), 0)
})

test('taxa zero, negativa ou inválida não mexe no valor', () => {
  for (const taxa of [0, -0.05, NaN]) {
    assert.equal(brutoParaReceber(1000, taxa), 1000)
    assert.equal(liquidoDoBruto(1000, taxa), 1000)
  }
})
