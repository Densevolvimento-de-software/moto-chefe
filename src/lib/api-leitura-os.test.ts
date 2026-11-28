import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  codificarCursorDaOS, cursorDaUltimaOS, lerCursorDaOS, montarOSDaApi, TIPO_DO_ITEM,
  type ItemOSBanco, type LinhaOSBanco,
} from './api-leitura-os'
import type { Periodo } from './api-leitura-vendas'

const PERIODO: Periodo = { de: '2026-11-01', ate: '2026-11-27' }
const OS_ID = '3f9c2d1e-8a7b-4c6d-9e0f-1a2b3c4d5e6f'
const OUTRA_OS_ID = '00000000-0000-4000-8000-000000000002'
const LOJA_ID = '11111111-1111-4111-8111-111111111111'
const TECNICO_ID = '22222222-2222-4222-8222-222222222222'
const MOTO_ID = '33333333-3333-4333-8333-333333333333'
const base64 = (valor: unknown) => Buffer.from(JSON.stringify(valor)).toString('base64url')

function linha(extra: Partial<LinhaOSBanco> = {}): LinhaOSBanco {
  return {
    id: OS_ID, numero: 7, status: 'concluida',
    dataAbertura: new Date('2026-11-10T12:00:00.123Z'), dataConclusao: new Date('2026-11-12T15:00:00.000Z'),
    lojaId: LOJA_ID, lojaNome: 'Loja 325', tecnicoId: TECNICO_ID, tecnicoNome: 'Técnico Sintético 325',
    motoId: MOTO_ID, chassiMoto: 'CHASSI-ESTOQUE-325', chassiOs: null, marcaExterna: null, modeloExterno: null,
    valorTotal: 350, ...extra,
  }
}

function item(extra: Partial<ItemOSBanco> = {}): ItemOSBanco {
  return { osId: OS_ID, tipo: 'servico', quantidade: 2, valorUnitario: 150.5, valor: 301, ...extra }
}

test('a OS sai só com a lista fechada de campos', () => {
  const [os] = montarOSDaApi([linha()], [])
  assert.deepEqual(Object.keys(os).sort(), ['abertura', 'chassi', 'conclusao', 'id', 'itens', 'loja', 'marca', 'modelo', 'numero', 'status', 'tecnico', 'total'])
})

test('moto do estoque sai com chassi, sem marca nem modelo de fora', () => {
  const [os] = montarOSDaApi([linha()], [])
  assert.equal(os.chassi, 'CHASSI-ESTOQUE-325')
  assert.equal(os.marca, null)
  assert.equal(os.modelo, null)
})

test('moto de fora sai com marca, modelo e o chassi informado na OS', () => {
  const [os] = montarOSDaApi([linha({ motoId: null, chassiMoto: null, chassiOs: 'CHASSI-OS-325', marcaExterna: 'MarcaSintetica', modeloExterno: 'ModeloSintetico' })], [])
  assert.equal(os.marca, 'MarcaSintetica')
  assert.equal(os.modelo, 'ModeloSintetico')
  assert.equal(os.chassi, 'CHASSI-OS-325')
})

test('moto de fora sem chassi informado sai com chassi nulo', () => {
  const [os] = montarOSDaApi([linha({ motoId: null, chassiMoto: null, chassiOs: null, marcaExterna: 'M', modeloExterno: 'X' })], [])
  assert.equal(os.chassi, null)
})

test('datas saem em ISO UTC com milissegundo; conclusão nula quando a OS não foi concluída', () => {
  const [concluida] = montarOSDaApi([linha()], [])
  assert.equal(concluida.abertura, '2026-11-10T12:00:00.123Z')
  assert.equal(concluida.conclusao, '2026-11-12T15:00:00.000Z')
  const [aberta] = montarOSDaApi([linha({ status: 'aberta', dataConclusao: null })], [])
  assert.equal(aberta.conclusao, null)
})

test('técnico sai com id e nome; sem técnico sai nulo', () => {
  const [com] = montarOSDaApi([linha()], [])
  assert.deepEqual(com.tecnico, { id: TECNICO_ID, nome: 'Técnico Sintético 325' })
  const [sem] = montarOSDaApi([linha({ tecnicoId: null, tecnicoNome: null })], [])
  assert.equal(sem.tecnico, null)
})

test('total sai como está gravado; total nulo sai zero', () => {
  const [gravado] = montarOSDaApi([linha({ valorTotal: 350 })], [])
  assert.equal(gravado.total, 350)
  const [nulo] = montarOSDaApi([linha({ valorTotal: null })], [])
  assert.equal(nulo.total, 0)
})

test('serviço vira mão de obra e peça vira peça', () => {
  assert.deepEqual(TIPO_DO_ITEM, { servico: 'mao_de_obra', peca: 'peca' })
  const [os] = montarOSDaApi([linha()], [item({ tipo: 'servico' }), item({ tipo: 'peca', valor: 40 })])
  assert.deepEqual(os.itens.map(i => i.tipo), ['mao_de_obra', 'peca'])
})

test('item de tipo fora da lista não sai', () => {
  const [os] = montarOSDaApi([linha()], [item({ tipo: 'outro' })])
  assert.deepEqual(os.itens, [])
})

test('OS sem item sai com lista vazia', () => {
  const [os] = montarOSDaApi([linha()], [])
  assert.deepEqual(os.itens, [])
})

test('cada OS leva só os próprios itens', () => {
  const [, outra] = montarOSDaApi([linha(), linha({ id: OUTRA_OS_ID })], [item({ osId: OUTRA_OS_ID, valor: 99 })])
  assert.equal(outra.itens.length, 1)
  assert.equal(montarOSDaApi([linha()], [item({ osId: OUTRA_OS_ID })])[0].itens.length, 0)
})

test('item sai com tipo, quantidade, valor unitário e valor da linha, e só esses campos', () => {
  const [os] = montarOSDaApi([linha()], [item({ quantidade: 2, valorUnitario: 150.5, valor: 301 })])
  assert.deepEqual(Object.keys(os.itens[0]).sort(), ['quantidade', 'tipo', 'valor', 'valorUnitario'])
  assert.deepEqual(os.itens[0], { tipo: 'mao_de_obra', quantidade: 2, valorUnitario: 150.5, valor: 301 })
})

test('sem cursor é a primeira página', () => {
  assert.deepEqual(lerCursorDaOS(null, PERIODO), { ok: true, cursor: null })
})

test('cursor de uma OS volta com a mesma data em milissegundos e o mesmo id', () => {
  const texto = codificarCursorDaOS(cursorDaUltimaOS(linha()))
  assert.deepEqual(lerCursorDaOS(texto, PERIODO), { ok: true, cursor: { d: '2026-11-10T12:00:00.123Z', i: OS_ID } })
})

test('cursor com id que não é uuid não vale', () => {
  assert.deepEqual(lerCursorDaOS(base64({ d: '2026-11-10T12:00:00.123Z', i: 'nao-e-uuid' }), PERIODO), { ok: false })
})

test('cursor com o formato de outro conjunto (campo n) não vale', () => {
  assert.deepEqual(lerCursorDaOS(base64({ d: '2026-11-10T12:00:00.123Z', n: 7 }), PERIODO), { ok: false })
})

test('cursor com data sem milissegundo não vale', () => {
  assert.deepEqual(lerCursorDaOS(base64({ d: '2026-11-10T12:00:00Z', i: OS_ID }), PERIODO), { ok: false })
})

test('cursor que não é base64url de objeto não vale', () => {
  assert.deepEqual(lerCursorDaOS('nao-e-base64!', PERIODO), { ok: false })
})

test('cursor de data fora do período não vale; a última hora de 27/11 em Brasília vale, 28/11 à meia-noite não', () => {
  assert.equal(lerCursorDaOS(base64({ d: '2026-12-01T12:00:00.000Z', i: OS_ID }), PERIODO).ok, false)
  assert.equal(lerCursorDaOS(base64({ d: '2026-11-28T02:59:59.999Z', i: OS_ID }), PERIODO).ok, true)
  assert.equal(lerCursorDaOS(base64({ d: '2026-11-28T03:00:00.000Z', i: OS_ID }), PERIODO).ok, false)
})
