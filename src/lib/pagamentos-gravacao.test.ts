import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { PgtoOS } from './conciliacao-status'
import {
  CAMPOS_PAGAMENTO_ENTRADA,
  CAMPOS_PAGAMENTO_OS,
  CAMPOS_PAGAMENTO_VENDA,
  pagamentosParaGravar,
} from './pagamentos-gravacao'

const MARCA_GRAVADA = { motivo: 'caiu na conta', porId: 'u-gestor', porNome: 'Gestor', em: '2026-11-01T12:00:00.000Z' }
const MARCA_DA_TELA = { motivo: 'qualquer', porId: 'u-outro', porNome: 'Outro', em: '2026-11-02T12:00:00.000Z' }
const CARTAO = { tipo: 'cartao_credito', valor: 500, operadora: 'op-1', parcelas: 3, autorizacao: 'A1B2' }

// Pedido com campos a mais, como chega de uma chamada direta à Server Action.
const comCamposAMais = (p: PgtoOS) => ({ ...p, conciliadoManual: MARCA_DA_TELA, extra: 'x' }) as PgtoOS

test('criação: cada pagamento sai só com os campos da tela do alvo', () => {
  const daTela = [comCamposAMais({ tipo: 'pix', valor: 1000 }), comCamposAMais({ ...CARTAO, cupom: 'C1' })]
  assert.deepEqual(pagamentosParaGravar(daTela, CAMPOS_PAGAMENTO_VENDA, []), [{ tipo: 'pix', valor: 1000 }, CARTAO])
})

test('OS guarda o código do cupom; entrada da reserva e da demanda não guarda autorização nem cupom', () => {
  const cupom = { tipo: 'cupom_revisao', valor: 150, cupom: 'REV-1' }
  assert.deepEqual(pagamentosParaGravar([comCamposAMais(cupom)], CAMPOS_PAGAMENTO_OS, []), [cupom])
  assert.deepEqual(
    pagamentosParaGravar([comCamposAMais({ ...CARTAO, cupom: 'C1' })], CAMPOS_PAGAMENTO_ENTRADA, []),
    [{ tipo: 'cartao_credito', valor: 500, operadora: 'op-1', parcelas: 3 }],
  )
})

test('campo que não é texto nem número fica de fora, e campo ausente não vira chave vazia', () => {
  const daTela = [{ tipo: 'cartao_credito', valor: 500, operadora: { nome: 'x' }, autorizacao: ['A'] }] as unknown as PgtoOS[]
  assert.deepEqual(pagamentosParaGravar(daTela, CAMPOS_PAGAMENTO_VENDA, []), [{ tipo: 'cartao_credito', valor: 500 }])
})

test('edição: pagamento com o mesmo tipo e valor mantém a marca gravada, não a da tela', () => {
  const gravados = [{ tipo: 'pix', valor: '1000.00', conciliadoManual: MARCA_GRAVADA }, { tipo: 'dinheiro', valor: 200 }]
  const daTela = [comCamposAMais({ tipo: 'pix', valor: 1000 }), comCamposAMais({ tipo: 'dinheiro', valor: 200 })]
  assert.deepEqual(pagamentosParaGravar(daTela, CAMPOS_PAGAMENTO_VENDA, gravados), [
    { tipo: 'pix', valor: 1000, conciliadoManual: MARCA_GRAVADA },
    { tipo: 'dinheiro', valor: 200 },
  ])
})

test('edição: a marca cai quando o valor ou o tipo do pagamento mudam', () => {
  const gravados = [{ tipo: 'pix', valor: 1000, conciliadoManual: MARCA_GRAVADA }]
  assert.deepEqual(
    pagamentosParaGravar([{ tipo: 'pix', valor: 900 }, { tipo: 'dinheiro', valor: 100 }], CAMPOS_PAGAMENTO_VENDA, gravados),
    [{ tipo: 'pix', valor: 900 }, { tipo: 'dinheiro', valor: 100 }],
  )
  assert.deepEqual(
    pagamentosParaGravar([{ tipo: 'transferencia', valor: 1000 }], CAMPOS_PAGAMENTO_VENDA, gravados),
    [{ tipo: 'transferencia', valor: 1000 }],
  )
})

test('edição: cartão forçado mantém a marca quando só operadora, parcelas ou autorização mudam', () => {
  const gravados = [{ ...CARTAO, conciliadoManual: MARCA_GRAVADA }]
  const editado = { ...CARTAO, operadora: 'op-2', parcelas: 6, autorizacao: 'Z9' }
  assert.deepEqual(pagamentosParaGravar([editado], CAMPOS_PAGAMENTO_VENDA, gravados), [{ ...editado, conciliadoManual: MARCA_GRAVADA }])
})

test('edição: cada marca gravada vale para um pagamento só, mesmo com a ordem trocada', () => {
  const gravados = [
    { tipo: 'dinheiro', valor: 100 },
    { tipo: 'pix', valor: 500, conciliadoManual: MARCA_GRAVADA },
    { tipo: 'pix', valor: 500 },
  ]
  const daTela = [{ tipo: 'pix', valor: 500 }, { tipo: 'pix', valor: 500 }, { tipo: 'dinheiro', valor: 100 }]
  assert.deepEqual(pagamentosParaGravar(daTela, CAMPOS_PAGAMENTO_VENDA, gravados), [
    { tipo: 'pix', valor: 500, conciliadoManual: MARCA_GRAVADA },
    { tipo: 'pix', valor: 500 },
    { tipo: 'dinheiro', valor: 100 },
  ])
})

test('registro sem lista de pagamentos gravada (nulo ou formato antigo) não dá marca a ninguém', () => {
  const daTela = [comCamposAMais({ tipo: 'pix', valor: 1000 })]
  for (const gravados of [null, undefined, { tipo: 'pix', valor: 1000, conciliadoManual: MARCA_GRAVADA }]) {
    assert.deepEqual(pagamentosParaGravar(daTela, CAMPOS_PAGAMENTO_VENDA, gravados), [{ tipo: 'pix', valor: 1000 }])
  }
})
