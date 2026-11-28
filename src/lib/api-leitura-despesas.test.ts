import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  aposCursorDeDespesa, codificarCursorDeDespesas, cursorDaDespesa, lerCursorDeDespesas, linhaDaDespesa, mesDaData,
  ordenarLinhasDespesa, somarEmpresaGeral, type LinhaDespesa,
} from './api-leitura-despesas'

const PERIODO = { de: '2026-01', ate: '2026-03' }
const LOJA_A = '5f1c8a3e-2b7d-4c1e-9a0f-3d2e1b4c5a6a'
const LOJA_B = '5f1c8a3e-2b7d-4c1e-9a0f-3d2e1b4c5a6b'
const GRUPO = '7e2d9b1a-4c3f-4e8a-8b6d-1f0a2c3d4e5f'
const CNPJ = '32600000000001'
const base64 = (valor: unknown) => Buffer.from(JSON.stringify(valor)).toString('base64url')

const linha = (o: Partial<LinhaDespesa> & Pick<LinhaDespesa, 'ano' | 'mes'>): LinhaDespesa => ({
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
  assert.equal(deGeral.k, CNPJ)
  assert.deepEqual(lerCursorDeDespesas(codificarCursorDeDespesas(deLoja), PERIODO), { ok: true, cursor: deLoja })
  assert.deepEqual(lerCursorDeDespesas(codificarCursorDeDespesas(deGeral), PERIODO), { ok: true, cursor: deGeral })
})

test('cursor com tipo de linha fora de 0 e 1, categoria que não é texto, chave que não é UUID, ou campo a mais não vale', () => {
  assert.deepEqual(lerCursorDeDespesas(base64({ a: 2026, m: 2, t: 2, k: LOJA_A, c: 'Luz' }), PERIODO), { ok: false })
  assert.deepEqual(lerCursorDeDespesas(base64({ a: 2026, m: 2, t: 0, k: '', c: 'Luz' }), PERIODO), { ok: false })
  // CNPJ no lugar do id do grupo: a chave da empresa geral é UUID, nunca CNPJ.
  assert.deepEqual(lerCursorDeDespesas(base64({ a: 2026, m: 2, t: 1, k: '32.600.000/0001-11', c: 'Luz' }), PERIODO), { ok: false })
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
  const l = linhaDaDespesa({ ano: 2026, mes: 2, loja: com(LOJA_A, 'Loja Sintética 326'), cnpj: CNPJ, grupoDre: 'operacional', categoria: 'Luz', valor: 1234.5678 })
  assert.deepEqual(l, { ano: 2026, mes: 2, loja: { id: LOJA_A, nome: 'Loja Sintética 326' }, cnpj: CNPJ, grupoDre: 'operacional', categoria: 'Luz', valor: 1234.57 })
  assert.deepEqual(Object.keys(l).sort(), ['ano', 'categoria', 'cnpj', 'grupoDre', 'loja', 'mes', 'valor'])
})


test('empresa geral: o cursor leva o CNPJ em dígitos como chave, não o id do grupo', () => {
  const cursor = cursorDaDespesa(linha({ ano: 2026, mes: 2, categoria: 'Luz' }))
  assert.equal(cursor.k, CNPJ)
  assert.deepEqual(lerCursorDeDespesas(codificarCursorDeDespesas(cursor), PERIODO), { ok: true, cursor })
})

test('empresa geral: um id de grupo (UUID) no lugar do CNPJ no cursor não vale', () => {
  assert.deepEqual(lerCursorDeDespesas(base64({ a: 2026, m: 2, t: 1, k: GRUPO, c: 'Luz' }), PERIODO), { ok: false })
})

test('empresa geral de grupos com o mesmo CNPJ sai somada numa linha por mês e categoria', () => {
  const somada = somarEmpresaGeral([
    linha({ ano: 2026, mes: 2, valor: 150 }),
    linha({ ano: 2026, mes: 2, valor: 40 }),
    linha({ ano: 2026, mes: 2, loja: com(LOJA_A, 'A'), valor: 7 }),
  ])
  assert.deepEqual(somada.map(l => [l.loja?.id ?? 'geral', l.valor]), [[LOJA_A, 7], ['geral', 190]])
})
