import { test } from 'node:test'
import assert from 'node:assert/strict'
import { saidaEntraNaDespesa, type ContaLiberadaDespesa } from './despesa-contas-liberadas'

// Datas em meia-noite de Brasília (03:00Z): a liberação começa no dia, não em UTC.
const INICIO = new Date('2026-09-01T03:00:00.000Z')
const ANTES = new Date('2026-09-01T02:59:59.999Z')
const NO_INICIO = new Date('2026-09-01T03:00:00.000Z')
const DEPOIS = new Date('2026-09-02T15:00:00.000Z')

const BANCO_A = 'Banco A Empresas'
const BANCO_B = 'Banco B Empresas'

const COM_INICIO: ContaLiberadaDespesa[] = [{ banco: BANCO_A, inicioEm: INICIO }]
const SEM_INICIO: ContaLiberadaDespesa[] = [{ banco: BANCO_A, inicioEm: null }]

test('conta liberada sem início: qualquer data entra', () => {
  assert.equal(saidaEntraNaDespesa(BANCO_A, DEPOIS, SEM_INICIO), true)
})

test('conta liberada com início: saída depois do início entra', () => {
  assert.equal(saidaEntraNaDespesa(BANCO_A, DEPOIS, COM_INICIO), true)
})

test('conta liberada com início: saída exatamente no início entra', () => {
  assert.equal(saidaEntraNaDespesa(BANCO_A, NO_INICIO, COM_INICIO), true)
})

test('conta liberada com início: saída antes do início não entra', () => {
  assert.equal(saidaEntraNaDespesa(BANCO_A, ANTES, COM_INICIO), false)
})

test('conta que não está na lista do grupo não entra', () => {
  assert.equal(saidaEntraNaDespesa(BANCO_B, DEPOIS, SEM_INICIO), false)
})

test('grupo sem nenhuma conta liberada não aceita saída', () => {
  assert.equal(saidaEntraNaDespesa(BANCO_A, DEPOIS, []), false)
})
