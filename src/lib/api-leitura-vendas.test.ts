import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  codificarCursor, cortarPagina, custoDaVenda, cursorDaUltimaLinha, lerCursor, linhaDaVendaMoto, periodoDaApi,
  type LinhaVendaMotoBanco, type Periodo,
} from './api-leitura-vendas'

const PERIODO: Periodo = { de: '2026-11-01', ate: '2026-11-27' }
const base64 = (valor: unknown) => Buffer.from(JSON.stringify(valor)).toString('base64url')

test('período dentro do histórico, de até o fim, devolve os dois dias', () => {
  assert.deepEqual(periodoDaApi({ de: '2026-11-01', ate: '2026-11-27' }), { de: '2026-11-01', ate: '2026-11-27' })
})

test('período sem de ou sem ate não vale', () => {
  assert.equal(periodoDaApi({ ate: '2026-11-27' }), null)
  assert.equal(periodoDaApi({ de: '2026-11-01' }), null)
  assert.equal(periodoDaApi({}), null)
})

test('de depois de ate não vale', () => {
  assert.equal(periodoDaApi({ de: '2026-11-28', ate: '2026-11-27' }), null)
})

test('início antes de 01/01/2026 não vale; 01/01/2026 vale', () => {
  assert.equal(periodoDaApi({ de: '2025-12-31', ate: '2026-01-31' }), null)
  assert.deepEqual(periodoDaApi({ de: '2026-01-01', ate: '2026-01-31' }), { de: '2026-01-01', ate: '2026-01-31' })
})

test('92 dias contando os extremos vale; 93 não', () => {
  assert.deepEqual(periodoDaApi({ de: '2026-08-01', ate: '2026-10-31' }), { de: '2026-08-01', ate: '2026-10-31' })
  assert.equal(periodoDaApi({ de: '2026-07-31', ate: '2026-10-31' }), null)
})

test('data que não existe ou fora do formato AAAA-MM-DD não vale, sem devolver o valor', () => {
  assert.equal(periodoDaApi({ de: '2026-02-30', ate: '2026-03-01' }), null)
  assert.equal(periodoDaApi({ de: '2026-1-5', ate: '2026-01-31' }), null)
  assert.equal(periodoDaApi({ de: '27/11/2026', ate: '2026-11-27' }), null)
})

test('cursor gerado volta igual e vale no próprio período', () => {
  const cursor = { d: '2026-11-10T12:00:00.000Z', n: 42 }
  assert.deepEqual(lerCursor(codificarCursor(cursor), PERIODO), { ok: true, cursor })
})

test('ausência de cursor é a primeira página', () => {
  assert.deepEqual(lerCursor(null, PERIODO), { ok: true, cursor: null })
})

test('cursor que não é base64url, JSON ou tem campo a mais não vale', () => {
  assert.equal(lerCursor('não-é-base64!', PERIODO).ok, false)
  assert.equal(lerCursor(Buffer.from('{ruim').toString('base64url'), PERIODO).ok, false)
  assert.equal(lerCursor(base64({ d: '2026-11-10T12:00:00.000Z', n: 1, extra: 'x' }), PERIODO).ok, false)
  assert.equal(lerCursor(base64({ d: '2026-11-10T12:00:00.000Z' }), PERIODO).ok, false)
})

test('cursor com tipo errado ou data inválida não vale', () => {
  assert.equal(lerCursor(base64({ d: '2026-11-10T12:00:00.000Z', n: '42' }), PERIODO).ok, false)
  assert.equal(lerCursor(base64({ d: '2026-11-10T12:00:00.000Z', n: 0 }), PERIODO).ok, false)
  assert.equal(lerCursor(base64({ d: '2026-11-10 12:00:00', n: 1 }), PERIODO).ok, false)
  assert.equal(lerCursor(base64({ d: '2026-13-10T12:00:00.000Z', n: 1 }), PERIODO).ok, false)
})

test('cursor que cai fora do período não vale', () => {
  // 28/11 00:00 de Brasília já é outro dia: fora do período que termina em 27/11.
  assert.equal(lerCursor(base64({ d: '2026-11-28T03:00:00.000Z', n: 1 }), PERIODO).ok, false)
  // 31/10 23:00 de Brasília é antes de 01/11: fora do período que começa em 01/11.
  assert.equal(lerCursor(base64({ d: '2026-11-01T02:00:00.000Z', n: 1 }), PERIODO).ok, false)
})

test('página com 500 linhas é a última: não há próxima', () => {
  const linhas = Array.from({ length: 500 }, (_, i) => i)
  assert.deepEqual(cortarPagina(linhas), { linhas, temMais: false })
})

test('página com 501 linhas corta em 500 e avisa que tem mais', () => {
  const linhas = Array.from({ length: 501 }, (_, i) => i)
  const corte = cortarPagina(linhas)
  assert.equal(corte.linhas.length, 500)
  assert.equal(corte.temMais, true)
  assert.equal(corte.linhas[499], 499)
})

test('cursor da última linha da página aponta para a data e o número dela', () => {
  const ultima = { dataVenda: new Date('2026-11-10T12:00:00.000Z'), numero: 42 }
  assert.deepEqual(cursorDaUltimaLinha(ultima), { d: '2026-11-10T12:00:00.000Z', n: 42 })
})

test('custo sai só de Conta autorizada; sem autorização é nulo mesmo com custo', () => {
  assert.equal(custoDaVenda(false, 1000), null)
  assert.equal(custoDaVenda(true, 1000), 1000)
  assert.equal(custoDaVenda(true, null), null)
})

const linhaDoBanco = (extra: Partial<LinhaVendaMotoBanco> = {}): LinhaVendaMotoBanco => ({
  dataVenda: new Date('2026-11-10T12:00:00.000Z'), numero: 7,
  lojaId: 'loja-1', lojaNome: 'Loja 1', vendedorId: 'vend-1', vendedorNome: 'Vendedora',
  modelo: 'X819', cor: 'PRETO', chassi: 'CHASSI1', valor: 9990,
  contaAutorizada: true, custo: 7000, cepCliente: '30140071', numeroNf: '1',
  ...extra,
})

test('linha da venda tem só as colunas da lista, e a data é o dia de Brasília', () => {
  const linha = linhaDaVendaMoto(linhaDoBanco())
  assert.deepEqual(Object.keys(linha).sort(), ['cepCliente', 'chassi', 'cor', 'custo', 'data', 'loja', 'modelo', 'numero', 'numeroNf', 'valor', 'vendedor'])
  assert.deepEqual(linha, {
    data: '2026-11-10', numero: 7, loja: { id: 'loja-1', nome: 'Loja 1' }, vendedor: { id: 'vend-1', nome: 'Vendedora' },
    modelo: 'X819', cor: 'PRETO', chassi: 'CHASSI1', valor: 9990, custo: 7000, cepCliente: '30140071', numeroNf: '1',
  })
})

test('venda às 02:30 UTC do 1º de novembro é do dia 31/10 em Brasília', () => {
  const linha = linhaDaVendaMoto(linhaDoBanco({ dataVenda: new Date('2026-11-01T02:30:00.000Z') }))
  assert.equal(linha.data, '2026-10-31')
})

test('linha da venda não copia campos extras que a entrada trouxer (cliente e afins)', () => {
  const entrada = { ...linhaDoBanco(), clienteNome: 'NomeClienteSintetico', clienteCpf: '98765432100', clienteEmail: 'cliente@teste.invalid' }
  const texto = JSON.stringify(linhaDaVendaMoto(entrada as LinhaVendaMotoBanco))
  assert.equal(texto.includes('NomeClienteSintetico'), false)
  assert.equal(texto.includes('98765432100'), false)
  assert.equal(texto.includes('cliente@teste.invalid'), false)
})

test('linha da venda não autorizada sai com custo nulo', () => {
  assert.equal(linhaDaVendaMoto(linhaDoBanco({ contaAutorizada: false })).custo, null)
})
