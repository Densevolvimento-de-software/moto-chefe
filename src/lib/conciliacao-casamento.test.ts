import { test } from 'node:test'
import assert from 'node:assert/strict'
import { linhaDaTransacao, semAlvos as nenhum } from './conciliacao-casamento'

const AGORA = new Date('2026-11-12T12:00:00.000Z')
const transacao = {
  nsu: '991', autorizacao: 'A1', dataTransacao: '2026-11-10', valorBruto: 900, valorLiquido: 868.5,
  parcelas: 3, tipo: 'credito' as const, status: 'aprovado', rawData: { id: 991 },
}
const semAlvos = nenhum()

test('linha casada com uma venda nasce conciliada, com a hora passada', () => {
  assert.deepEqual(linhaDaTransacao('g1', 'mercadopago', transacao, { ...semAlvos, vendaId: 'v1' }, AGORA), {
    grupoId: 'g1', operadora: 'mercadopago', dataTransacao: '2026-11-10', nsu: '991', autorizacao: 'A1',
    valorBruto: '900', valorLiquido: '868.5', parcelas: 3, tipo: 'credito', status: 'aprovado',
    vendaId: 'v1', pecaVendaId: null, osId: null, conciliado: true, conciliadoEm: AGORA, rawData: { id: 991 },
  })
})

test('linha sem alvo nasce pendente; sem nsu, autorização, líquido e raw_data vão nulos', () => {
  const l = linhaDaTransacao('g1', 'stone', { dataTransacao: '2026-11-10', valorBruto: 50, parcelas: 1, tipo: 'debito', status: 'approved' }, semAlvos, AGORA)
  assert.equal(l.conciliado, false)
  assert.equal(l.conciliadoEm, null)
  assert.deepEqual([l.nsu, l.autorizacao, l.valorLiquido, l.rawData], [null, null, null, null])
})

test('peça e OS também contam como casada', () => {
  assert.equal(linhaDaTransacao('g1', 'stone', transacao, { ...semAlvos, pecaVendaId: 'p1' }, AGORA).conciliado, true)
  assert.equal(linhaDaTransacao('g1', 'stone', transacao, { ...semAlvos, osId: 'o1' }, AGORA).conciliado, true)
})
