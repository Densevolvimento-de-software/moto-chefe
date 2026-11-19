import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pagamentosDoFormulario, pgtosDoPagamento } from './pagamentos-fields'

test('as linhas do formulário viram o pagamento da action: valor em número; operadora e parcelas só quando preenchidas; sem autorização', () => {
  assert.deepEqual(pagamentosDoFormulario([
    { id: '1', tipo: 'cartao_credito', valor: '1500.50', operadora: 'stone', parcelas: '10', autorizacao: 'ABC123' },
    { id: '2', tipo: 'pix', valor: '200.00', operadora: '', parcelas: '' },
  ]), [
    { tipo: 'cartao_credito', valor: 1500.5, operadora: 'stone', parcelas: 10 },
    { tipo: 'pix', valor: 200 },
  ])
})

test('pgtosDoPagamento: o pagamento gravado vira as linhas do formulário (valor com 2 casas, parcelas em texto) e volta igual', () => {
  const gravado = [{ tipo: 'pix', valor: 8000 }, { tipo: 'cartao_credito', valor: 7160.5, operadora: 'stone', parcelas: 10, autorizacao: 'A1' }]
  const linhas = pgtosDoPagamento(gravado)
  assert.deepEqual(linhas.map(({ id: _, ...l }) => l), [
    { tipo: 'pix', valor: '8000.00' },
    { tipo: 'cartao_credito', valor: '7160.50', operadora: 'stone', parcelas: '10', autorizacao: 'A1' },
  ])
  assert.equal(new Set(linhas.map(l => l.id)).size, 2)
  assert.deepEqual(pagamentosDoFormulario(linhas), gravado.map(({ autorizacao: _, ...p }) => p))
})
