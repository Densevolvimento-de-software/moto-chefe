import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  codificarCursorDeMetas, cursorDaMeta, lerCursorDeMetas, linhaDaMeta, ordemDoMes, periodoDeMesesDaApi,
  periodoParaAcesso, type PeriodoMeses,
} from './api-leitura-metas'

const PERIODO: PeriodoMeses = { de: '2026-01', ate: '2026-12' }
const LOJA = '5f1c8a3e-2b7d-4c1e-9a0f-3d2e1b4c5a6f'

test('período de 2026-01 a 2026-12 vale: são 12 meses, o máximo', () => {
  assert.deepEqual(periodoDeMesesDaApi({ de: '2026-01', ate: '2026-12' }), { de: '2026-01', ate: '2026-12' })
})

test('13 meses não vale', () => {
  assert.equal(periodoDeMesesDaApi({ de: '2026-01', ate: '2027-01' }), null)
})

test('início antes de 01/2026 não vale; 01/2026 vale', () => {
  assert.equal(periodoDeMesesDaApi({ de: '2025-12', ate: '2026-03' }), null)
  assert.deepEqual(periodoDeMesesDaApi({ de: '2026-01', ate: '2026-03' }), { de: '2026-01', ate: '2026-03' })
})

test('início depois do fim não vale; sem um dos dois não vale', () => {
  assert.equal(periodoDeMesesDaApi({ de: '2026-05', ate: '2026-04' }), null)
  assert.equal(periodoDeMesesDaApi({ de: '2026-01' }), null)
  assert.equal(periodoDeMesesDaApi({ ate: '2026-04' }), null)
  assert.equal(periodoDeMesesDaApi({}), null)
})

test('mês fora do formato AAAA-MM ou inexistente não vale', () => {
  assert.equal(periodoDeMesesDaApi({ de: '2026-13', ate: '2026-14' }), null)
  assert.equal(periodoDeMesesDaApi({ de: '2026-1', ate: '2026-03' }), null)
  assert.equal(periodoDeMesesDaApi({ de: '2026-00', ate: '2026-03' }), null)
  assert.equal(periodoDeMesesDaApi({ de: '01/2026', ate: '2026-03' }), null)
})

test('ordem do mês: AAAA*100 + mês, para comparar e para a chave do cursor', () => {
  assert.equal(ordemDoMes('2026-03'), 202603)
  assert.equal(ordemDoMes('2026-12'), 202612)
})

test('cursor gerado volta igual e vale dentro do período', () => {
  const cursor = { a: 2026, m: 7, l: LOJA }
  assert.deepEqual(lerCursorDeMetas(codificarCursorDeMetas(cursor), PERIODO), { ok: true, cursor })
})

test('ausência de cursor é a primeira página', () => {
  assert.deepEqual(lerCursorDeMetas(null, PERIODO), { ok: true, cursor: null })
})

test('cursor de outro período não vale', () => {
  const texto = codificarCursorDeMetas({ a: 2027, m: 1, l: LOJA })
  assert.deepEqual(lerCursorDeMetas(texto, PERIODO), { ok: false })
})

test('cursor que não é base64url, não é objeto, tem campo a mais ou mês 13 não vale', () => {
  const base64 = (valor: unknown) => Buffer.from(JSON.stringify(valor)).toString('base64url')
  assert.deepEqual(lerCursorDeMetas('não é cursor', PERIODO), { ok: false })
  assert.deepEqual(lerCursorDeMetas(base64([1, 2]), PERIODO), { ok: false })
  assert.deepEqual(lerCursorDeMetas(base64({ a: 2026, m: 7, l: LOJA, x: 1 }), PERIODO), { ok: false })
  assert.deepEqual(lerCursorDeMetas(base64({ a: 2026, m: 13, l: LOJA }), PERIODO), { ok: false })
  assert.deepEqual(lerCursorDeMetas(base64({ a: 2026, m: 7, l: 'não-é-uuid' }), PERIODO), { ok: false })
})

test('a linha da meta tem só loja (id e nome), ano, mês e valor, com o valor como número', () => {
  const linha = linhaDaMeta({ ano: 2026, mes: 7, lojaId: LOJA, lojaNome: 'Loja Sintética 326', valorMeta: '12345.60' })
  assert.deepEqual(linha, { ano: 2026, mes: 7, loja: { id: LOJA, nome: 'Loja Sintética 326' }, valor: 12345.6 })
  assert.deepEqual(Object.keys(linha).sort(), ['ano', 'loja', 'mes', 'valor'])
})

test('o cursor da última linha aponta para a própria linha', () => {
  assert.deepEqual(cursorDaMeta({ ano: 2026, mes: 7, lojaId: LOJA }), { a: 2026, m: 7, l: LOJA })
})

test('período para o registro de acesso: primeiro dia do início e último dia do fim', () => {
  assert.deepEqual(periodoParaAcesso({ de: '2026-02', ate: '2026-02' }), { ini: '2026-02-01', fim: '2026-02-28' })
  assert.deepEqual(periodoParaAcesso({ de: '2028-01', ate: '2028-02' }), { ini: '2028-01-01', fim: '2028-02-29' })
})
