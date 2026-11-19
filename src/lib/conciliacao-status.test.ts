import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  calcStatusMultiPagamento,
  comForcado,
  semForcado,
  matchPagamentos,
  estornosDosPagamentos,
  precisaConciliar,
  valorConciliadoManual,
  type ConciliadoManual,
  type PgtoOS,
} from './conciliacao-status'

const FORCADO: ConciliadoManual = {
  motivo: 'PIX caiu na conta pessoal',
  porId: 'u1',
  porNome: 'Cesar',
  em: '2026-07-31T12:00:00.000Z',
}

// ── valorConciliadoManual ────────────────────────────────────────────────────

test('soma só os pagamentos forçados', () => {
  const pgtos: PgtoOS[] = [
    { tipo: 'pix', valor: 1000, conciliadoManual: FORCADO },
    { tipo: 'cartao_credito', valor: 500 },
  ]
  assert.equal(valorConciliadoManual(pgtos), 1000)
})

test('dinheiro forçado não soma — não conta pro total a conciliar', () => {
  const pgtos: PgtoOS[] = [{ tipo: 'dinheiro', valor: 800, conciliadoManual: FORCADO }]
  assert.equal(valorConciliadoManual(pgtos), 0)
})

test('sem pagamentos não quebra', () => {
  assert.equal(valorConciliadoManual(null), 0)
  assert.equal(valorConciliadoManual([]), 0)
})

// ── calcStatusMultiPagamento ─────────────────────────────────────────────────

test('pagamento forçado sozinho fecha a conciliação', () => {
  const pgtos: PgtoOS[] = [{ tipo: 'pix', valor: 9000, conciliadoManual: FORCADO }]
  assert.equal(calcStatusMultiPagamento(pgtos, 0, 0, '9000'), 'conciliada')
})

test('1 de 2 formas forçada fica parcial', () => {
  const pgtos: PgtoOS[] = [
    { tipo: 'pix', valor: 4000, conciliadoManual: FORCADO },
    { tipo: 'cartao_credito', valor: 5000 },
  ]
  assert.equal(calcStatusMultiPagamento(pgtos, 0, 0, '9000'), 'parcial')
})

test('forçado somado ao que já estava conciliado de verdade fecha', () => {
  const pgtos: PgtoOS[] = [
    { tipo: 'pix', valor: 4000, conciliadoManual: FORCADO },
    { tipo: 'cartao_credito', valor: 5000 },
  ]
  assert.equal(calcStatusMultiPagamento(pgtos, 5000, 0, '9000'), 'conciliada')
})

test('sem o campo o status atual é preservado — não-regressão', () => {
  const pgtos: PgtoOS[] = [{ tipo: 'cartao_credito', valor: 9000 }]
  assert.equal(calcStatusMultiPagamento(pgtos, 0, 0, '9000'), 'pendente')
  assert.equal(calcStatusMultiPagamento(pgtos, 9000, 0, '9000'), 'conciliada')
  assert.equal(calcStatusMultiPagamento([], 0, 0, '9000'), 'na')
})

test('forçar não conserta pagamento lançado a menos que o valor da venda', () => {
  // Só R$ 4.000 lançados numa venda de R$ 9.000: falta lançamento, não conciliação.
  const pgtos: PgtoOS[] = [{ tipo: 'pix', valor: 4000, conciliadoManual: FORCADO }]
  assert.equal(calcStatusMultiPagamento(pgtos, 0, 0, '9000'), 'parcial')
})

// ── matchPagamentos ──────────────────────────────────────────────────────────

const conciliados = (r: ReturnType<typeof matchPagamentos>) => r.map(x => x.conciliado)

test('forçado aparece como conciliado na linha', () => {
  const pgtos: PgtoOS[] = [{ tipo: 'cartao_credito', valor: 500, conciliadoManual: FORCADO }]
  assert.deepEqual(conciliados(matchPagamentos(pgtos, [], [])), [true])
})

test('forçado não rouba a transação por valor do irmão pendente', () => {
  const pgtos: PgtoOS[] = [
    { tipo: 'cartao_credito', valor: 500, conciliadoManual: FORCADO },
    { tipo: 'cartao_debito', valor: 500 },
  ]
  const concs = [{ id: 'c1', autorizacao: null, valorBruto: 500 }]
  // A única transação real tem que sobrar para o pagamento que ainda está pendente.
  assert.deepEqual(conciliados(matchPagamentos(pgtos, concs, [])), [true, true])
})

test('match por autorização continua valendo com um irmão forçado', () => {
  const pgtos: PgtoOS[] = [
    { tipo: 'pix', valor: 1000, conciliadoManual: FORCADO },
    { tipo: 'cartao_credito', valor: 500, autorizacao: 'ABC123' },
  ]
  const concs = [{ id: 'c1', autorizacao: 'ABC123', valorBruto: 500 }]
  assert.deepEqual(conciliados(matchPagamentos(pgtos, concs, [])), [true, true])
})

// ── Cobertura por valor: a linha só fica verde se o dinheiro recebido cobre ──
// Regressão da venda #30744 e cia: a linha dizia "conciliado" com valor faltando.

test('PIX recebido a menos não fecha a linha (venda #30744)', () => {
  const pgtos: PgtoOS[] = [{ tipo: 'pix', valor: 10990 }]
  const r = matchPagamentos(pgtos, [], [{ id: 'p1', valor: 5990 }])
  assert.equal(r[0].conciliado, false)
  assert.equal(r[0].coberto, 5990)
})

test('um recebimento PIX não pinta os dois pagamentos PIX (venda #30732)', () => {
  const pgtos: PgtoOS[] = [
    { tipo: 'pix', valor: 2000 },
    { tipo: 'pix', valor: 10490 },
  ]
  const r = matchPagamentos(pgtos, [], [{ id: 'p1', valor: 2000 }])
  assert.deepEqual(conciliados(r), [true, false])
  assert.equal(r[1].coberto, 0)
})

test('PIX recebido em várias parcelas soma e fecha', () => {
  const pgtos: PgtoOS[] = [{ tipo: 'pix', valor: 10490 }]
  const r = matchPagamentos(pgtos, [], [
    { id: 'p1', valor: 5000 }, { id: 'p2', valor: 5000 }, { id: 'p3', valor: 490 },
  ])
  assert.equal(r[0].conciliado, true)
})

test('cartão casado por autorização com valor menor não fecha (venda #30729)', () => {
  const pgtos: PgtoOS[] = [{ tipo: 'cartao_debito', valor: 997.42, autorizacao: '568252' }]
  const r = matchPagamentos(pgtos, [{ id: 'c1', autorizacao: '568252', valorBruto: 990 }], [])
  assert.equal(r[0].conciliado, false)
  assert.equal(r[0].coberto, 990)
})

test('transação vinculada que não casa com nenhuma linha ainda cobre o que falta', () => {
  // Uma única transação agregada de 200 para dois pagamentos de 100: nenhuma casa
  // por valor exato, mas o dinheiro entrou e o badge da tabela diz conciliada.
  const pgtos: PgtoOS[] = [
    { tipo: 'cartao_credito', valor: 100 },
    { tipo: 'cartao_credito', valor: 100 },
  ]
  const r = matchPagamentos(pgtos, [{ id: 'c1', autorizacao: null, valorBruto: 200 }], [])
  assert.deepEqual(conciliados(r), [true, true])
})

test('linha verde em tudo implica badge conciliada — as duas contas concordam', () => {
  const pgtos: PgtoOS[] = [
    { tipo: 'pix', valor: 7000 },
    { tipo: 'cartao_credito', valor: 6590, autorizacao: 'X1' },
  ]
  const concs   = [{ id: 'c1', autorizacao: 'X1', valorBruto: 6590 }]
  const pixRecs = [{ id: 'p1', valor: 7000 }]

  assert.deepEqual(conciliados(matchPagamentos(pgtos, concs, pixRecs)), [true, true])
  assert.equal(calcStatusMultiPagamento(pgtos, 6590, 7000, '13590'), 'conciliada')
})

test('venda #30751 real: PIX curto deixa linha aberta e badge parcial', () => {
  const pgtos: PgtoOS[] = [
    { tipo: 'pix', valor: 7000 },
    { tipo: 'cartao_credito', valor: 6590, autorizacao: 'X1' },
  ]
  const concs   = [{ id: 'c1', autorizacao: 'X1', valorBruto: 6590 }]
  const pixRecs = [{ id: 'p1', valor: 6000 }]

  assert.deepEqual(conciliados(matchPagamentos(pgtos, concs, pixRecs)), [false, true])
  assert.equal(calcStatusMultiPagamento(pgtos, 6590, 6000, '13590'), 'parcial')
})

test('PIX casa pela linha de mesmo valor antes de ratear (NF 2284)', () => {
  // Venda 556bb9b2: três PIX lançados, e os recebimentos de 5.000 e 1.000 conciliados.
  // O rateio na ordem pintava a linha de 4.490 e deixava as duas certas em vermelho.
  const pgtos: PgtoOS[] = [
    { tipo: 'pix', valor: 4490 },
    { tipo: 'pix', valor: 5000 },
    { tipo: 'pix', valor: 1000 },
  ]
  const r = matchPagamentos(pgtos, [], [{ id: 'p1', valor: 5000 }, { id: 'p2', valor: 1000 }])
  assert.deepEqual(conciliados(r), [false, true, true])
  assert.equal(r[0].coberto, 0)
})

// ── Financiamento (decisão do Cesar em 01/09/2026) ───────────────────────────
// A venda financiada deixou de esperar aprovação para ser lançada. Em troca, o
// financiamento nasce PENDENTE e só fecha quando alguém confirma que caiu na
// conta — antes ele não gerava pendência nenhuma e a venda saía conciliada.

test('financiamento precisa ser conferido, dinheiro e cortesia não', () => {
  assert.equal(precisaConciliar('financiamento'), true)
  assert.equal(precisaConciliar('dinheiro'), false)
  assert.equal(precisaConciliar('cortesia'), false)
  assert.equal(precisaConciliar('bonificacao'), false)
  assert.equal(precisaConciliar('cupom_revisao'), false)
})

test('venda só de financiamento fica pendente até alguém confirmar', () => {
  const pgtos = [{ tipo: 'financiamento', valor: 15000 }]
  assert.equal(calcStatusMultiPagamento(pgtos, 0, 0, '15000'), 'pendente')
})

test('financiamento confirmado na mão fecha a venda', () => {
  const pgtos = [{
    tipo: 'financiamento',
    valor: 15000,
    conciliadoManual: { motivo: 'Caiu na conta do Sicoob', porId: 'u1', porNome: 'Cesar', em: '2026-09-01' },
  }]
  assert.equal(calcStatusMultiPagamento(pgtos, 0, 0, '15000'), 'conciliada')
})

test('entrada em PIX já conciliada + financiamento em aberto fica parcial', () => {
  const pgtos = [{ tipo: 'pix', valor: 5000 }, { tipo: 'financiamento', valor: 10000 }]
  assert.equal(calcStatusMultiPagamento(pgtos, 0, 5000, '15000'), 'parcial')
})

test('dinheiro puro continua conciliado sem nada a conferir', () => {
  assert.equal(calcStatusMultiPagamento([{ tipo: 'dinheiro', valor: 9000 }], 0, 0, '9000'), 'conciliada')
})

// ── comForcado / semForcado ─────────────────────────────────────────────────

const AUTOR = { porId: 'u9', porNome: 'Aux da loja', em: '2026-11-18T15:00:00.000Z' }
const PIX_E_DINHEIRO: PgtoOS[] = [{ tipo: 'pix', valor: 1000 }, { tipo: 'dinheiro', valor: 200 }]

test('comForcado marca só o pagamento da posição, com o motivo sem espaços nas pontas e o autor', () => {
  assert.deepEqual(comForcado(PIX_E_DINHEIRO, 0, '  PIX na conta pessoal ', AUTOR), {
    ok: true,
    dados: [
      { tipo: 'pix', valor: 1000, conciliadoManual: { motivo: 'PIX na conta pessoal', porId: 'u9', porNome: 'Aux da loja', em: '2026-11-18T15:00:00.000Z' } },
      { tipo: 'dinheiro', valor: 200 },
    ],
  })
  assert.deepEqual(PIX_E_DINHEIRO, [{ tipo: 'pix', valor: 1000 }, { tipo: 'dinheiro', valor: 200 }], 'não muda o array recebido')
})

test('comForcado recusa motivo curto ou que não é texto', () => {
  for (const motivo of ['', ' ok ', null, 123, { motivo: 'abc' }]) {
    assert.deepEqual(comForcado(PIX_E_DINHEIRO, 0, motivo, AUTOR), { ok: false, erro: 'Informe o motivo da conciliação forçada' }, String(motivo))
  }
})

test('comForcado e semForcado recusam posição que não é índice inteiro do array', () => {
  for (const idx of ['length', '0', 1.5, -1, 2] as unknown as number[]) {
    assert.deepEqual(comForcado(PIX_E_DINHEIRO, idx, 'PIX na conta', AUTOR), { ok: false, erro: 'Pagamento não encontrado' }, `com ${idx}`)
    assert.deepEqual(semForcado(PIX_E_DINHEIRO, idx), { ok: false, erro: 'Pagamento não encontrado' }, `sem ${idx}`)
  }
})

test('comForcado recusa pagamento que não espera depósito (dinheiro)', () => {
  assert.deepEqual(comForcado(PIX_E_DINHEIRO, 1, 'PIX na conta', AUTOR), { ok: false, erro: 'Esse pagamento não precisa de conciliação' })
})

test('semForcado tira só a marcação da posição e mantém o resto do pagamento', () => {
  const forcados: PgtoOS[] = [
    { tipo: 'pix', valor: 1000, conciliadoManual: FORCADO },
    { tipo: 'cartao_credito', valor: 500, parcelas: 3, conciliadoManual: FORCADO },
  ]
  assert.deepEqual(semForcado(forcados, 1), {
    ok: true,
    dados: [{ tipo: 'pix', valor: 1000, conciliadoManual: FORCADO }, { tipo: 'cartao_credito', valor: 500, parcelas: 3 }],
  })
})

// Pix da maquininha Mercado Pago é linha tipo pix da conciliação de cartão (#51).
test('linha pix da conciliação de cartão cobre o pagamento Pix, não o de cartão', () => {
  const pgtos: PgtoOS[] = [
    { tipo: 'cartao_credito', valor: 500 },
    { tipo: 'pix', valor: 300 },
  ]
  const concs = [{ id: 'c1', autorizacao: null, valorBruto: 300, tipo: 'pix' }]
  assert.deepEqual(matchPagamentos(pgtos, concs, []), [
    { conciliado: false, coberto: 0 },
    { conciliado: true, coberto: 300 },
  ])
})

test('linha de crédito não cobre pagamento Pix', () => {
  const pgtos: PgtoOS[] = [{ tipo: 'pix', valor: 300 }]
  const concs = [{ id: 'c1', autorizacao: null, valorBruto: 300, tipo: 'credito' }]
  assert.deepEqual(matchPagamentos(pgtos, concs, []), [{ conciliado: false, coberto: 0 }])
})

// #51 (PR6c): pagamento que voltou a pendente porque a linha da maquininha foi estornada diz isso, com o dia.
test('estornosDosPagamentos: pendente com estorno do mesmo meio e valor é marcado; conciliado e outro meio não', () => {
  const pgtos: PgtoOS[] = [
    { tipo: 'pix', valor: 450 },
    { tipo: 'cartao_credito', valor: 450 },
    { tipo: 'pix', valor: 300 },
    { tipo: 'pix', valor: 450 },
  ]
  const cobertura = [{ conciliado: false, coberto: 0 }, { conciliado: false, coberto: 0 }, { conciliado: true, coberto: 300 }, { conciliado: false, coberto: 0 }]
  const estornos = [
    { id: 'e1', valorBruto: '450.00', tipo: 'pix' },
    { id: 'e2', valorBruto: '300.00', tipo: 'pix' },
  ]
  // O 1º PIX de 450 usa o estorno e1; o cartão de 450 não casa com linha pix; o PIX de 300 está conciliado;
  // o 2º PIX de 450 não tem outro estorno.
  assert.deepEqual(estornosDosPagamentos(pgtos, cobertura, estornos), [true, false, false, false])
})

// #51 (PR6c, V1): depois de vincular, o painel diz de onde veio o PIX: "Conciliado · PIX na maquininha Mercado Pago".
test('matchPagamentos: PIX coberto pela linha pix da maquininha guarda a operadora; pelo banco, não', () => {
  const pgtos: PgtoOS[] = [{ tipo: 'pix', valor: 3550 }, { tipo: 'pix', valor: 90 }]
  const linhasDoAlvo = [{ id: 'mp', autorizacao: null, valorBruto: '3550.00', tipo: 'pix', operadora: 'mercadopago' }]
  assert.deepEqual(matchPagamentos(pgtos, linhasDoAlvo, [{ id: 'bco', valor: '90.00' }]), [
    { conciliado: true, coberto: 3550, pixDaMaquininha: 'mercadopago' },
    { conciliado: true, coberto: 90 },
  ])
})
