import { test } from 'node:test'
import assert from 'node:assert/strict'
import { montarRotulos, type ContaDaChave } from './rotulos-contas-mcp'

const corrente = (id: string, itemId: string, banco = 'Banco B'): ContaDaChave => ({ id, itemId, subtype: 'CHECKING_ACCOUNT', banco, lista: 'BANK' })
const poupanca = (id: string, itemId: string, banco = 'Banco B'): ContaDaChave => ({ id, itemId, subtype: 'SAVINGS_ACCOUNT', banco, lista: 'BANK' })
const cartao = (id: string, itemId: string, banco = 'Banco B'): ContaDaChave => ({ id, itemId, subtype: 'CREDIT_CARD', banco, lista: 'CREDIT' })
const textoDe = (contas: ContaDaChave[], id: string) => montarRotulos(contas).find(r => r.id === id)?.texto

test('conta corrente pelo id dela: banco e "conta"', () => {
  assert.equal(textoDe([corrente('c1', 'k1')], 'c1'), 'Banco B, conta')
})

test('credencial: banco, "credencial" e quantas contas correntes ela tem (a poupança não conta)', () => {
  const contas = [corrente('c1', 'k1'), corrente('c2', 'k1'), poupanca('p1', 'k1')]
  assert.equal(textoDe(contas, 'k1'), 'Banco B, credencial, 2 contas correntes')
})

test('credencial com uma conta corrente fala no singular', () => {
  assert.equal(textoDe([corrente('c1', 'k1')], 'k1'), 'Banco B, credencial, 1 conta corrente')
})

test('credencial só com poupança diz que não tem conta corrente', () => {
  assert.equal(textoDe([poupanca('p1', 'k1')], 'k1'), 'Banco B, credencial, nenhuma conta corrente')
})

test('credencial só com cartão diz que não entra no PIX', () => {
  assert.equal(textoDe([cartao('cc1', 'k1', 'Sicoob')], 'k1'), 'Sicoob, credencial, só cartão (não entra no PIX)')
})

test('poupança pelo id dela não é chamada de conta: avisa que não entra no PIX', () => {
  assert.equal(textoDe([poupanca('p1', 'k1')], 'p1'), 'Banco B, poupança (não entra no PIX)')
})

test('cartão pelo id dele avisa que não entra no PIX', () => {
  assert.equal(textoDe([cartao('cc1', 'k1', 'Sicoob')], 'cc1'), 'Sicoob, cartão (não entra no PIX)')
})

test('id que a chave não lista não tem rótulo', () => {
  assert.equal(textoDe([corrente('c1', 'k1')], 'outro'), undefined)
})

test('a saída traz só id e texto, uma entrada por conta e por credencial', () => {
  const r = montarRotulos([corrente('c1', 'k1'), corrente('c2', 'k1')])
  assert.deepEqual(r.map(x => x.id).sort(), ['c1', 'c2', 'k1'])
  assert.ok(r.every(x => Object.keys(x).sort().join() === 'id,texto'))
})
