import { test } from 'node:test'
import assert from 'node:assert/strict'
import { opcoesDeResponsavel, podeEscolherVendedor, vendedorDaVenda } from './vendedor-escolhido'

const LOGADO = { id: 'logado', papel: 'aux_adm' }

test('admin_geral, admin_socio e aux_adm escolhem o vendedor; os demais papéis não', () => {
  for (const papel of ['admin_geral', 'admin_socio', 'aux_adm']) assert.equal(podeEscolherVendedor(papel), true, papel)
  for (const papel of ['vendedor', 'mecanico', 'cargo', 'admin_rede']) assert.equal(podeEscolherVendedor(papel), false, papel)
})

test('quem pode escolher e escolheu: a venda sai no nome escolhido', () => {
  assert.equal(vendedorDaVenda(LOGADO, 'outro'), 'outro')
})

test('quem pode escolher e não escolheu: a venda sai no nome de quem registra', () => {
  assert.equal(vendedorDaVenda(LOGADO, undefined), 'logado')
  assert.equal(vendedorDaVenda(LOGADO, null), 'logado')
  assert.equal(vendedorDaVenda(LOGADO, ''), 'logado')
})

test('quem não pode escolher e mandou um id: o id é ignorado e a venda sai no nome de quem registra', () => {
  assert.equal(vendedorDaVenda({ id: 'logado', papel: 'vendedor' }, 'outro'), 'logado')
})

const lojas = [{ id: 'l1', nome: 'Loja Centro' }, { id: 'l2', nome: 'Loja Norte' }]

test('opções do responsável: ordem alfabética, com a loja de cada pessoa', () => {
  const doGrupo = [
    { id: 'b', nome: 'Bruno', lojaId: 'l2' },
    { id: 'a', nome: 'Ágata', lojaId: 'l1' },
    { id: 'c', nome: 'Caio', lojaId: null },
  ]
  assert.deepEqual(opcoesDeResponsavel(doGrupo, lojas, { id: 'a', nome: 'Ágata', lojaId: 'l1' }), [
    { id: 'a', nome: 'Ágata', lojaNome: 'Loja Centro' },
    { id: 'b', nome: 'Bruno', lojaNome: 'Loja Norte' },
    { id: 'c', nome: 'Caio', lojaNome: null },
  ])
})

test('opções do responsável: quem registra entra na lista mesmo fora do grupo da loja', () => {
  const doGrupo = [{ id: 'b', nome: 'Bruno', lojaId: 'l1' }]
  const opcoes = opcoesDeResponsavel(doGrupo, lojas, { id: 'z', nome: 'Zélia', lojaId: null })
  assert.deepEqual(opcoes.map(o => o.id), ['b', 'z'])
})

test('opções do responsável: loja fora das lojas do grupo vira sem loja', () => {
  const opcoes = opcoesDeResponsavel([{ id: 'b', nome: 'Bruno', lojaId: 'l-de-outro-grupo' }], lojas, { id: 'b', nome: 'Bruno', lojaId: 'l-de-outro-grupo' })
  assert.equal(opcoes[0].lojaNome, null)
})

test('opções do responsável: quem registra e já está na lista não repete', () => {
  const doGrupo = [{ id: 'a', nome: 'Ágata', lojaId: 'l1' }]
  assert.equal(opcoesDeResponsavel(doGrupo, lojas, { id: 'a', nome: 'Ágata', lojaId: 'l1' }).length, 1)
})
