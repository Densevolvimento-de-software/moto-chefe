import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  aposCursorDeDespesa, codificarCursorDeDespesas, cursorDaDespesa, lerCursorDeDespesas, linhaDaDespesa, mesDaData,
  ordenarLinhasDespesa, type LinhaDespesaDaApi,
} from './api-leitura-despesas'

const PERIODO = { de: '2026-01', ate: '2026-03' }
const LOJA_A = '5f1c8a3e-2b7d-4c1e-9a0f-3d2e1b4c5a6a'
const LOJA_B = '5f1c8a3e-2b7d-4c1e-9a0f-3d2e1b4c5a6b'
const CNPJ = '32600000000001'
const base64 = (valor: unknown) => Buffer.from(JSON.stringify(valor)).toString('base64url')

const linha = (o: Partial<LinhaDespesaDaApi> & Pick<LinhaDespesaDaApi, 'ano' | 'mes'>): LinhaDespesaDaApi => ({
  loja: null, cnpj: CNPJ, grupoDre: 'operacional', categoria: 'Luz', valor: 10, ...o,
})
const com = (id: string, nome: string) => ({ id, nome })

test('mês de uma data: timestamp usa o calendário de Brasília; data pura usa o próprio dia', () => {
  assert.equal(mesDaData(new Date('2026-03-01T02:30:00Z')), '2026-02')
  assert.equal(mesDaData(new Date('2026-03-01T12:00:00Z')), '2026-03')
  assert.equal(mesDaData('2026-02-28'), '2026-02')
})

test('ordem: dentro do mês, loja vem antes da empresa geral; lojas por id; geral por último', () => {
  const embaralhadas = [
    linha({ ano: 2026, mes: 2, categoria: 'Luz' }),
    linha({ ano: 2026, mes: 2, loja: com(LOJA_B, 'B'), categoria: 'Luz' }),
    linha({ ano: 2026, mes: 1, loja: com(LOJA_A, 'A'), categoria: 'Luz' }),
    linha({ ano: 2026, mes: 2, loja: com(LOJA_A, 'A'), categoria: 'Luz' }),
    linha({ ano: 2026, mes: 2, loja: com(LOJA_A, 'A'), categoria: 'Aluguel' }),
  ]
  const ordem = ordenarLinhasDespesa(embaralhadas).map(l => `${l.mes}|${l.loja?.id ?? 'geral'}|${l.categoria}`)
  assert.deepEqual(ordem, [
    `1|${LOJA_A}|Luz`,
    `2|${LOJA_A}|Aluguel`,
    `2|${LOJA_A}|Luz`,
    `2|${LOJA_B}|Luz`,
    '2|geral|Luz',
  ])
  assert.equal(embaralhadas[0].mes, 2)
})

test('cursor de loja e cursor de empresa geral voltam iguais e valem dentro do período', () => {
  const deLoja = cursorDaDespesa(linha({ ano: 2026, mes: 2, loja: com(LOJA_A, 'A'), categoria: 'Luz' }))
  const deGeral = cursorDaDespesa(linha({ ano: 2026, mes: 2, categoria: 'Luz' }))
  assert.deepEqual(lerCursorDeDespesas(codificarCursorDeDespesas(deLoja), PERIODO), { ok: true, cursor: deLoja })
  assert.deepEqual(lerCursorDeDespesas(codificarCursorDeDespesas(deGeral), PERIODO), { ok: true, cursor: deGeral })
})

test('cursor com tipo de linha fora de 0 e 1, categoria que não é texto, chave vazia ou campo a mais não vale', () => {
  assert.deepEqual(lerCursorDeDespesas(base64({ a: 2026, m: 2, t: 2, k: LOJA_A, c: 'Luz' }), PERIODO), { ok: false })
  assert.deepEqual(lerCursorDeDespesas(base64({ a: 2026, m: 2, t: 0, k: '', c: 'Luz' }), PERIODO), { ok: false })
  assert.deepEqual(lerCursorDeDespesas(base64({ a: 2026, m: 2, t: 0, k: LOJA_A, c: 7 }), PERIODO), { ok: false })
  assert.deepEqual(lerCursorDeDespesas(base64({ a: 2026, m: 2, t: 0, k: LOJA_A, c: 'Luz', x: 1 }), PERIODO), { ok: false })
})

test('cursor de mês fora do período não vale', () => {
  assert.deepEqual(lerCursorDeDespesas(base64({ a: 2027, m: 1, t: 0, k: LOJA_A, c: 'Luz' }), PERIODO), { ok: false })
})

test('depois do cursor: a própria linha não conta; a linha seguinte conta; a geral do mesmo mês vem depois da loja', () => {
  const cursor = cursorDaDespesa(linha({ ano: 2026, mes: 2, loja: com(LOJA_A, 'A'), categoria: 'Luz' }))
  assert.equal(aposCursorDeDespesa(linha({ ano: 2026, mes: 2, loja: com(LOJA_A, 'A'), categoria: 'Luz' }), cursor), false)
  assert.equal(aposCursorDeDespesa(linha({ ano: 2026, mes: 2, loja: com(LOJA_A, 'A'), categoria: 'Water' }), cursor), true)
  assert.equal(aposCursorDeDespesa(linha({ ano: 2026, mes: 2, categoria: 'Luz' }), cursor), true)
  assert.equal(aposCursorDeDespesa(linha({ ano: 2026, mes: 1, loja: com(LOJA_B, 'B'), categoria: 'Luz' }), cursor), false)
})

test('a linha tem só as colunas da lista; o valor sai com duas casas', () => {
  const l = linhaDaDespesa({ ano: 2026, mes: 2, loja: com(LOJA_A, 'Loja Sintética 326'), cnpj: null, grupoDre: 'operacional', categoria: 'Luz', valor: 1234.5678 })
  assert.deepEqual(l, { ano: 2026, mes: 2, loja: { id: LOJA_A, nome: 'Loja Sintética 326' }, cnpj: null, grupoDre: 'operacional', categoria: 'Luz', valor: 1234.57 })
  assert.deepEqual(Object.keys(l).sort(), ['ano', 'categoria', 'cnpj', 'grupoDre', 'loja', 'mes', 'valor'])
})
