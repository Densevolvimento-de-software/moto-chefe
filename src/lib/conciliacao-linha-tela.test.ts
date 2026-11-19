// Linha da /conciliacao como a tela mostra (#51, PR6b): a tabela do desktop e a lista do celular leem o mesmo objeto.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { linhaNaTela, type LinhaDoBanco } from './conciliacao-linha-tela'

const ALVOS = {
  vendas: new Map([['v1', { id: 'v1', numero: 31902, clienteNome: 'Maria Souza', valor: '8900.00' }]]),
  pecas: new Map([['p1', { id: 'p1', numero: 2211, clienteNome: 'Carlos Lima', valor: '320.00' }]]),
  os: new Map([['o1', { id: 'o1', numero: 77, clienteNome: 'Ana Reis', valor: '150.00' }]]),
}
const BASE: LinhaDoBanco = {
  id: 'c1', operadora: 'mercadopago', dataTransacao: '2026-11-06', tipo: 'credito', parcelas: 3, valorBruto: '8900.00',
  valorLiquido: '8512.40', nsu: '123400009932', status: 'aprovado', vendaId: null, pecaVendaId: null, osId: null,
  rawData: { bandeira: 'visa', portador: 'MARIA S' },
}

test('pendente: nome da operadora, rótulo, bandeira, portador, valores em número, sem alvo', () => {
  assert.deepEqual(linhaNaTela(BASE, ALVOS), {
    id: 'c1', data: '2026-11-06', operadora: 'Mercado Pago', rotulo: 'Cré 3x', credito: true, bandeira: 'visa',
    portador: 'MARIA S', valor: 8900, liquido: 8512.4, nsu: '123400009932', estornada: false, alvo: null,
  })
})

test('alvo vem da venda, da venda de peça ou da OS, com o tipo; id sem resumo (outra Conta) fica sem alvo', () => {
  assert.deepEqual(linhaNaTela({ ...BASE, vendaId: 'v1' }, ALVOS).alvo, { ...ALVOS.vendas.get('v1'), tipo: 'moto' })
  assert.deepEqual(linhaNaTela({ ...BASE, pecaVendaId: 'p1' }, ALVOS).alvo, { ...ALVOS.pecas.get('p1'), tipo: 'peca' })
  assert.deepEqual(linhaNaTela({ ...BASE, osId: 'o1' }, ALVOS).alvo, { ...ALVOS.os.get('o1'), tipo: 'os' })
  assert.equal(linhaNaTela({ ...BASE, vendaId: 'de-outra-conta' }, ALVOS).alvo, null)
})

test('estornada pelo status; sem líquido, sem raw e débito', () => {
  const l = linhaNaTela({ ...BASE, status: 'estornado', tipo: 'debito', parcelas: 1, valorLiquido: null, rawData: null }, ALVOS)
  assert.deepEqual([l.estornada, l.liquido, l.bandeira, l.portador, l.rotulo, l.credito], [true, null, '', '', 'Déb', false])
})
