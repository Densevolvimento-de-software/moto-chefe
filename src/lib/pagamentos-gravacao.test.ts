import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { PgtoOS } from './conciliacao-status'
import {
  CAMPOS_PAGAMENTO_ENTRADA,
  CAMPOS_PAGAMENTO_OS,
  CAMPOS_PAGAMENTO_VENDA,
  FRASE_PAGAMENTO_FORCADO,
  pagamentosParaGravar,
  recusaDePagamentoForcado,
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

// #220 (D1): quem grava e a opção do grupo decidem a recusa; a marca só conta se sai trocada ou removida.
const PIX_GRAVADO = { tipo: 'pix', valor: 1000, conciliadoManual: MARCA_GRAVADA }
const CARTAO_GRAVADO = { tipo: 'cartao_credito', valor: 500 }
const GRAVADOS = [PIX_GRAVADO, CARTAO_GRAVADO]
const TELA_MANTIDA = [{ tipo: 'pix', valor: 1000 }, { tipo: 'cartao_credito', valor: 600 }]
const TELA_TROCADA = [{ tipo: 'pix', valor: 900 }, { tipo: 'cartao_credito', valor: 600 }]
const TELA_REMOVIDA = [{ tipo: 'cartao_credito', valor: 1500 }]

test('recusaDePagamentoForcado: só aux_adm de grupo desligado recebe a frase, e só se a marca sai trocada ou removida', () => {
  const casos: [string, string, boolean, PgtoOS[], string | null][] = [
    ['aux_adm', 'desligada', false, TELA_MANTIDA, null],
    ['aux_adm', 'desligada', false, TELA_TROCADA, FRASE_PAGAMENTO_FORCADO],
    ['aux_adm', 'desligada', false, TELA_REMOVIDA, FRASE_PAGAMENTO_FORCADO],
    ['aux_adm', 'ligada', true, TELA_MANTIDA, null],
    ['aux_adm', 'ligada', true, TELA_TROCADA, null],
    ['aux_adm', 'ligada', true, TELA_REMOVIDA, null],
    ['admin_socio', 'desligada', false, TELA_TROCADA, null],
    ['admin_geral', 'desligada', false, TELA_REMOVIDA, null],
    // Demais papéis: hoje não recusa; a decisão sobre o vendedor é do Luis e fica para depois.
    ['vendedor', 'desligada', false, TELA_TROCADA, null],
  ]
  for (const [papel, opcao, auxAdmPodeForcar, daTela, esperado] of casos) {
    assert.equal(recusaDePagamentoForcado(papel, auxAdmPodeForcar, daTela, CAMPOS_PAGAMENTO_VENDA, GRAVADOS), esperado, `${papel} com opção ${opcao} e ${daTela.length} pagamento(s) na tela`)
  }
})

test('recusaDePagamentoForcado: sem marca gravada nada é recusado, mesmo para aux_adm de grupo desligado', () => {
  assert.equal(recusaDePagamentoForcado('aux_adm', false, TELA_TROCADA, CAMPOS_PAGAMENTO_VENDA, [{ tipo: 'pix', valor: 1000 }, CARTAO_GRAVADO]), null)
})
