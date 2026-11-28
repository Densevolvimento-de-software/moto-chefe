import test from 'node:test'
import assert from 'node:assert/strict'
import { agruparContas, contarMarcadas, erroAindaVale, lerAutorizacao, lerMarcacao, resumoDaTela, valorDaLinha, type ContaDaTela, type LinhaDaConta } from './motochefe-marcacao'

const LOJA_1 = '11111111-1111-4111-8111-111111111111'
const LOJA_2 = '11111111-1111-4111-8111-222222222222'
const CONTA_A = '22222222-2222-4222-8222-222222222222'
const CONTA_B = '22222222-2222-4222-8222-333333333333'

const linha = (p: Partial<LinhaDaConta>): LinhaDaConta => ({
  contaId: CONTA_A, contaNome: 'Conta A', autorizada: false,
  lojaId: null, lojaNome: null, cidade: null, ativa: null, marcada: null, ...p,
})

test('marcação: só lojaId e marcada passam; campo a mais do pedido some', () => {
  assert.deepEqual(lerMarcacao({ lojaId: LOJA_1, marcada: true, grupoId: 'x', ativa: false }), { lojaId: LOJA_1, marcada: true })
})

test('marcação: id que não é uuid, marcada que não é booleano ou pedido vazio são recusados', () => {
  assert.equal(lerMarcacao({ lojaId: 'abc', marcada: true }), null)
  assert.equal(lerMarcacao({ lojaId: LOJA_1, marcada: 'sim' }), null)
  assert.equal(lerMarcacao(null), null)
})

test('autorização: só contaId e autorizada passam; id inválido é recusado', () => {
  assert.deepEqual(lerAutorizacao({ contaId: CONTA_A, autorizada: true, nome: 'x', desativadaEm: '2020-01-01' }), { contaId: CONTA_A, autorizada: true })
  assert.equal(lerAutorizacao({ contaId: 'nao-e-uuid', autorizada: true }), null)
  assert.equal(lerAutorizacao({ contaId: CONTA_A, autorizada: 1 }), null)
})

test('agrupar: lojas vão para a sua Conta, na ordem em que aparecem; Conta sem loja fica com lista vazia', () => {
  const contas = agruparContas([
    linha({ contaId: CONTA_A, autorizada: true, lojaId: LOJA_1, lojaNome: 'Centro', cidade: 'Alfa', ativa: true, marcada: true }),
    linha({ contaId: CONTA_A, autorizada: true, lojaId: LOJA_2, lojaNome: 'Norte', cidade: 'Beta', ativa: false, marcada: false }),
    linha({ contaId: CONTA_B, contaNome: 'Conta B' }),
  ])
  assert.deepEqual(contas, [
    { id: CONTA_A, nome: 'Conta A', autorizada: true, lojas: [
      { id: LOJA_1, nome: 'Centro', cidade: 'Alfa', ativa: true, marcada: true },
      { id: LOJA_2, nome: 'Norte', cidade: 'Beta', ativa: false, marcada: false },
    ] },
    { id: CONTA_B, nome: 'Conta B', autorizada: false, lojas: [] },
  ])
})

// Mesmos números do protótipo da variante 2: 3 de 7 lojas, 2 de 3 Contas com loja marcada, 1 de 3 autorizadas.
test('resumo da tela bate com o protótipo: 3 de 7, 2 de 3 e 1 de 3', () => {
  const loja = (marcada: boolean) => ({ id: LOJA_1, nome: 'L', cidade: 'C', ativa: true, marcada })
  const resumo = resumoDaTela([
    { id: CONTA_A, nome: 'A', autorizada: true, lojas: [loja(true), loja(true), loja(false), loja(false)] },
    { id: CONTA_B, nome: 'B', autorizada: false, lojas: [loja(true), loja(false)] },
    { id: 'c', nome: 'C', autorizada: false, lojas: [loja(false)] },
  ])
  assert.deepEqual(resumo, { lojasMarcadas: 3, lojasTotal: 7, contasComMarcada: 2, contasTotal: 3, contasAutorizadas: 1 })
})

test('contar marcadas: conta só as lojas marcadas, e uma Conta sem loja dá zero', () => {
  const loja = (marcada: boolean) => ({ id: LOJA_1, nome: 'L', cidade: 'C', ativa: true, marcada })
  assert.equal(contarMarcadas([loja(true), loja(false), loja(true)]), 2)
  assert.equal(contarMarcadas([]), 0)
})

const CONTAS_DA_REGRA: ContaDaTela[] = [
  { id: CONTA_A, nome: 'A', autorizada: true, lojas: [{ id: LOJA_1, nome: 'L1', cidade: 'C', ativa: true, marcada: false }] },
  { id: CONTA_B, nome: 'B', autorizada: false, lojas: [] },
]

test('valor da linha: a loja e a Conta pelo id; linha que sumiu não tem valor', () => {
  assert.equal(valorDaLinha(CONTAS_DA_REGRA, { tipo: 'loja', id: LOJA_1 }), false)
  assert.equal(valorDaLinha(CONTAS_DA_REGRA, { tipo: 'conta', id: CONTA_A }), true)
  assert.equal(valorDaLinha(CONTAS_DA_REGRA, { tipo: 'loja', id: LOJA_2 }), undefined)
})

// O erro vale enquanto a linha segue como estava antes do pedido que falhou.
test('o erro ainda vale: só enquanto a linha segue como estava antes do pedido', () => {
  // Falhou ao marcar a loja (antes: desmarcada). A loja segue desmarcada: vale.
  assert.equal(erroAindaVale({ tipo: 'loja', id: LOJA_1, valor: true }, CONTAS_DA_REGRA), true)
  // Outro admin já marcou: o pedido ficou velho, o erro não vale.
  const marcada = CONTAS_DA_REGRA.map(c => ({ ...c, lojas: c.lojas.map(l => ({ ...l, marcada: true })) }))
  assert.equal(erroAindaVale({ tipo: 'loja', id: LOJA_1, valor: true }, marcada), false)
  // A loja sumiu da lista: o erro não vale.
  assert.equal(erroAindaVale({ tipo: 'loja', id: LOJA_2, valor: true }, CONTAS_DA_REGRA), false)
  // Falhou ao tirar a autorização (antes: autorizada). Segue autorizada: vale. Depois de tirada por outro: não vale.
  assert.equal(erroAindaVale({ tipo: 'conta', id: CONTA_A, valor: false }, CONTAS_DA_REGRA), true)
  assert.equal(erroAindaVale({ tipo: 'conta', id: CONTA_B, valor: true }, CONTAS_DA_REGRA), true)
  assert.equal(erroAindaVale({ tipo: 'conta', id: CONTA_A, valor: true }, CONTAS_DA_REGRA), false)
})
