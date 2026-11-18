import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pagamentosDoFormulario } from './pagamentos-fields'

test('as linhas do formulário viram o pagamento da action: valor em número; operadora e parcelas só quando preenchidas; sem autorização', () => {
  assert.deepEqual(pagamentosDoFormulario([
    { id: '1', tipo: 'cartao_credito', valor: '1500.50', operadora: 'stone', parcelas: '10', autorizacao: 'ABC123' },
    { id: '2', tipo: 'pix', valor: '200.00', operadora: '', parcelas: '' },
  ]), [
    { tipo: 'cartao_credito', valor: 1500.5, operadora: 'stone', parcelas: 10 },
    { tipo: 'pix', valor: 200 },
  ])
})
