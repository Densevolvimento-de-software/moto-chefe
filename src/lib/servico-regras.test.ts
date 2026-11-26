import test from 'node:test'
import assert from 'node:assert/strict'
import { podeGerirServicos } from './servico-regras'

test('gestão do catálogo: admin_geral e sócio (inclui admin_rede em casa); aux_adm e demais não', () => {
  assert.equal(podeGerirServicos({ papel: 'admin_geral' }), true)
  assert.equal(podeGerirServicos({ papel: 'admin_socio', grupoLiberado: null }), true)
  for (const papel of ['aux_adm', 'vendedor', 'mecanico']) assert.equal(podeGerirServicos({ papel }), false, papel)
})

test('gestão do catálogo: na persona de grupo liberado ninguém gere, nem sócio nem geral', () => {
  assert.equal(podeGerirServicos({ papel: 'admin_socio', grupoLiberado: 'grupo-de-fora' }), false)
  assert.equal(podeGerirServicos({ papel: 'admin_geral', grupoLiberado: 'grupo-de-fora' }), false)
})
