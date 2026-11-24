import { test } from 'node:test'
import assert from 'node:assert/strict'
import { podeAlterarValorVenda, podeTrocarVendedorVenda, travaDoValorVenda, travaDoVendedorVenda } from './valor-venda'

test('aux_adm é recusado ao mudar o valor da venda', () => {
  assert.equal(travaDoValorVenda('aux_adm', 10950, 10000), 'O valor da venda só pode ser alterado pelos administradores.')
})

test('aux_adm salva a edição quando o valor não muda', () => {
  assert.equal(travaDoValorVenda('aux_adm', 10950, 10950), null)
})

test('admins mudam o valor da venda', () => {
  assert.equal(travaDoValorVenda('admin_geral', 10950, 10000), null)
  assert.equal(travaDoValorVenda('admin_socio', 10950, 10000), null)
})

test('só admin_geral e admin_socio veem o valor editável', () => {
  assert.equal(podeAlterarValorVenda('admin_geral'), true)
  assert.equal(podeAlterarValorVenda('admin_socio'), true)
  assert.equal(podeAlterarValorVenda('aux_adm'), false)
  assert.equal(podeAlterarValorVenda('vendedor'), false)
})

test('aux_adm é recusado ao trocar o vendedor da venda', () => {
  assert.equal(travaDoVendedorVenda('aux_adm', 'vendedora-a', 'vendedora-b'), 'O vendedor da venda só pode ser trocado pelos sócios.')
})

test('aux_adm salva a edição quando o vendedor não muda ou não vem', () => {
  assert.equal(travaDoVendedorVenda('aux_adm', 'vendedora-a', 'vendedora-a'), null)
  assert.equal(travaDoVendedorVenda('aux_adm', 'vendedora-a', undefined), null)
})

test('sócios trocam o vendedor da venda', () => {
  assert.equal(travaDoVendedorVenda('admin_geral', 'vendedora-a', 'vendedora-b'), null)
  assert.equal(travaDoVendedorVenda('admin_socio', 'vendedora-a', 'vendedora-b'), null)
})

test('só admin_geral e admin_socio veem o vendedor editável', () => {
  assert.equal(podeTrocarVendedorVenda('admin_geral'), true)
  assert.equal(podeTrocarVendedorVenda('admin_socio'), true)
  assert.equal(podeTrocarVendedorVenda('aux_adm'), false)
  assert.equal(podeTrocarVendedorVenda('admin_rede'), false)
  assert.equal(podeTrocarVendedorVenda('vendedor'), false)
})
