import test from 'node:test'
import assert from 'node:assert/strict'
import { podeGerirServicos, recusaDoServico } from './servico-regras'

test('gestão do catálogo: admin_geral e sócio (inclui admin_rede em casa); aux_adm e demais não', () => {
  assert.equal(podeGerirServicos({ papel: 'admin_geral' }), true)
  assert.equal(podeGerirServicos({ papel: 'admin_socio', grupoLiberado: null }), true)
  for (const papel of ['aux_adm', 'vendedor', 'mecanico']) assert.equal(podeGerirServicos({ papel }), false, papel)
})

test('gestão do catálogo: na persona de grupo liberado ninguém gere, nem sócio nem geral', () => {
  assert.equal(podeGerirServicos({ papel: 'admin_socio', grupoLiberado: 'grupo-de-fora' }), false)
  assert.equal(podeGerirServicos({ papel: 'admin_geral', grupoLiberado: 'grupo-de-fora' }), false)
})

test('serviço válido não tem recusa', () => {
  assert.equal(recusaDoServico({ nome: 'Revisão', valor: 0 }), null)
  assert.equal(recusaDoServico({ nome: ' Troca de óleo ', valor: 120.5 }), null)
})

test('nome vazio ou só espaços é recusado', () => {
  assert.equal(recusaDoServico({ nome: '   ', valor: 10 }), 'Nome é obrigatório')
})

test('valor negativo é recusado', () => {
  assert.equal(recusaDoServico({ nome: 'Revisão', valor: -1 }), 'Valor não pode ser negativo')
})

test('valor que não é número finito (NaN, Infinity) é recusado', () => {
  for (const valor of [NaN, Infinity, -Infinity]) {
    assert.equal(recusaDoServico({ nome: 'Revisão', valor }), 'Valor inválido', String(valor))
  }
})
