import { test } from 'node:test'
import assert from 'node:assert/strict'
import { podeGerirConciliacao } from './conciliacao-papeis'

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
