import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fraseDeCompletaForcada, podeForcarConciliacao, podeGerirConciliacao } from './conciliacao-papeis'
import { COMPLETA_FORCADA, COMPLETA_FORCADA_PEDIR_A_GESTOR } from './conciliacao-status'

test('admin_geral, admin_socio e aux_adm gerem a conciliação', () => {
  for (const papel of ['admin_geral', 'admin_socio', 'aux_adm']) {
    assert.equal(podeGerirConciliacao(papel), true, papel)
  }
})

// admin_rede não aparece: na requisição ele já chega como admin_socio (usuarioDaRede).
test('vendedor, mecânico, motorista, cargo e papel vazio não gerem', () => {
  for (const papel of ['vendedor', 'mecanico', 'motorista', 'cargo', '']) {
    assert.equal(podeGerirConciliacao(papel), false, papel)
  }
})

// #220: forçar e desfazer forçada. admin_geral e admin_socio sempre; aux_adm só com a opção do grupo da loja ligada.
test('admin_geral e admin_socio forçam com a opção do grupo desligada', () => {
  for (const papel of ['admin_geral', 'admin_socio']) {
    assert.equal(podeForcarConciliacao(papel, false), true, papel)
  }
})

test('aux_adm força só com a opção do grupo ligada', () => {
  assert.equal(podeForcarConciliacao('aux_adm', true), true)
  assert.equal(podeForcarConciliacao('aux_adm', false), false)
})

test('vendedor, mecânico e papel vazio nunca forçam, nem com a opção ligada', () => {
  for (const papel of ['vendedor', 'mecanico', 'motorista', 'cargo', '']) {
    assert.equal(podeForcarConciliacao(papel, true), false, papel)
  }
})

test('papel desconhecido não força', () => {
  assert.equal(podeForcarConciliacao('xxx', true), false)
})

// Quem não força não pode desfazer a forçada: o desvincular pede ao gestor, na mesma frase da /pix-mcp.
test('desvincular de PIX que completa forçada: quem não força recebe a frase de pedir ao gestor', () => {
  assert.equal(fraseDeCompletaForcada(podeForcarConciliacao('aux_adm', false)), COMPLETA_FORCADA_PEDIR_A_GESTOR)
  assert.equal(fraseDeCompletaForcada(podeForcarConciliacao('aux_adm', true)), COMPLETA_FORCADA)
  assert.equal(fraseDeCompletaForcada(podeForcarConciliacao('admin_socio', false)), COMPLETA_FORCADA)
})
