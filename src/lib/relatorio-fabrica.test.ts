import { test } from 'node:test'
import assert from 'node:assert/strict'
import { agruparPorLoja, lojaEntraNoRelatorioFabrica, normalizarPeriodo, type LinhaModeloLoja } from './relatorio-fabrica'

const GALPAO = 'f154c1a5-c5ed-4bdc-af14-b1dea024beae'
const LAVRAS = 'd27be175-1a99-4382-a335-7a027195922e'
const VARGINHA = '44351a40-b800-47af-9e31-af4621b6cbc1'

test('Galpão Matriz e Lavras ficam fora do relatório', () => {
  assert.equal(lojaEntraNoRelatorioFabrica(GALPAO), false)
  assert.equal(lojaEntraNoRelatorioFabrica(LAVRAS), false)
})

test('as demais lojas entram', () => {
  assert.equal(lojaEntraNoRelatorioFabrica(VARGINHA), true)
})

const linha = (lojaId: string, lojaNome: string, modelo: string, quantidade: number, valor: number): LinhaModeloLoja =>
  ({ modeloId: modelo, marca: 'Shineray', modelo, lojaId, lojaNome, quantidade, valor })

test('soma quantidade e valor da loja entre os modelos', () => {
  const [g] = agruparPorLoja([
    linha('l1', 'Varginha', 'SHI 175', 3, 30000),
    linha('l1', 'Varginha', 'SHI 50', 2, 21000),
  ])
  assert.equal(g.quantidade, 5)
  assert.equal(g.valor, 51000)
  assert.equal(g.modelos.length, 2)
})

test('separa uma loja da outra', () => {
  const gs = agruparPorLoja([
    linha('l1', 'Varginha', 'SHI 175', 1, 10000),
    linha('l2', 'Itajuba', 'SHI 175', 1, 10000),
  ])
  assert.equal(gs.length, 2)
  assert.deepEqual([...gs.map(g => g.lojaNome)].sort(), ['Itajuba', 'Varginha'])
})

test('loja que mais vendeu vem primeiro', () => {
  const gs = agruparPorLoja([
    linha('l1', 'Pouco vendeu', 'SHI 175', 1, 10000),
    linha('l2', 'Campeã', 'SHI 175', 9, 90000),
  ])
  assert.deepEqual(gs.map(g => g.lojaNome), ['Campeã', 'Pouco vendeu'])
})

test('dentro da loja, o modelo que mais vendeu vem primeiro', () => {
  const [g] = agruparPorLoja([
    linha('l1', 'Varginha', 'Pouco vendido', 1, 10000),
    linha('l1', 'Varginha', 'Campeão', 9, 90000),
  ])
  assert.deepEqual(g.modelos.map(m => m.modelo), ['Campeão', 'Pouco vendido'])
})

test('empate na quantidade desempata pelo nome da loja', () => {
  const gs = agruparPorLoja([
    linha('l1', 'Zebra', 'SHI 175', 2, 1),
    linha('l2', 'Alfa', 'SHI 175', 2, 1),
  ])
  assert.deepEqual(gs.map(g => g.lojaNome), ['Alfa', 'Zebra'])
})

test('sem vendas, sem linhas', () => {
  assert.deepEqual(agruparPorLoja([]), [])
})

// 22h de Brasília no último dia do mês: em UTC já é o dia 1º do mês seguinte (#915).
test('período padrão no último dia do mês às 22h fica no mês de Brasília', () => {
  assert.deepEqual(
    normalizarPeriodo(undefined, undefined, new Date('2026-11-01T01:00:00.000Z')),
    { de: '2026-10-01', ate: '2026-10-31' },
  )
})

test('período padrão em 31/12 às 23h não pula para janeiro do ano seguinte', () => {
  assert.deepEqual(
    normalizarPeriodo(undefined, undefined, new Date('2027-01-01T02:00:00.000Z')),
    { de: '2026-12-01', ate: '2026-12-31' },
  )
})

test('período padrão durante o dia vai do dia 1º até hoje', () => {
  assert.deepEqual(
    normalizarPeriodo(undefined, undefined, new Date('2026-11-14T15:00:00.000Z')),
    { de: '2026-11-01', ate: '2026-11-14' },
  )
})

test('período válido da URL é mantido', () => {
  assert.deepEqual(
    normalizarPeriodo('2026-09-05', '2026-09-20', new Date('2026-11-01T01:00:00.000Z')),
    { de: '2026-09-05', ate: '2026-09-20' },
  )
})

test('período torto da URL cai no padrão do mês', () => {
  assert.deepEqual(
    normalizarPeriodo('2026-1-5', 'x', new Date('2026-11-14T15:00:00.000Z')),
    { de: '2026-11-01', ate: '2026-11-14' },
  )
})
