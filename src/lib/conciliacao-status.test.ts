import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  calcStatusMultiPagamento,
  comForcado,
  semForcado,
  matchPagamentos,
  pixCompletaForcadaParcial,
  resumoDaForcadaQueOPixCompleta,
  semForcadasQueOPixCompleta,
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
// Forçar PIX pede o valor que entrou na conta (#92); `coberto` é o que lançamentos já cobrem do pagamento.
const ENTROU_998 = { valorRecebido: 998, coberto: 0, baseVista: 1000 }

test('comForcado marca só o pagamento da posição, com o motivo sem espaços nas pontas e o autor', () => {
  assert.deepEqual(comForcado(PIX_E_DINHEIRO, 0, '  PIX na conta pessoal ', AUTOR, ENTROU_998), {
    ok: true,
    dados: [
      { tipo: 'pix', valor: 1000, conciliadoManual: {
        motivo: 'PIX na conta pessoal', porId: 'u9', porNome: 'Aux da loja', em: '2026-11-18T15:00:00.000Z',
        pix: { valorRecebido: 998, valorBruto: 1000, custoPix: 2, custoPixTaxa: 0.002 },
      } },
      { tipo: 'dinheiro', valor: 200 },
    ],
  })
  assert.deepEqual(PIX_E_DINHEIRO, [{ tipo: 'pix', valor: 1000 }, { tipo: 'dinheiro', valor: 200 }], 'não muda o array recebido')
})

test('comForcado recusa motivo curto ou que não é texto', () => {
  for (const motivo of ['', ' ok ', null, 123, { motivo: 'abc' }]) {
    assert.deepEqual(comForcado(PIX_E_DINHEIRO, 0, motivo, AUTOR, ENTROU_998), { ok: false, erro: 'Informe o motivo da conciliação forçada' }, String(motivo))
  }
})

test('comForcado e semForcado recusam posição que não é índice inteiro do array', () => {
  for (const idx of ['length', '0', 1.5, -1, 2] as unknown as number[]) {
    assert.deepEqual(comForcado(PIX_E_DINHEIRO, idx, 'PIX na conta', AUTOR, ENTROU_998), { ok: false, erro: 'Pagamento não encontrado' }, `com ${idx}`)
    assert.deepEqual(semForcado(PIX_E_DINHEIRO, idx), { ok: false, erro: 'Pagamento não encontrado' }, `sem ${idx}`)
  }
})

test('comForcado recusa pagamento que não espera depósito (dinheiro)', () => {
  assert.deepEqual(comForcado(PIX_E_DINHEIRO, 1, 'PIX na conta', AUTOR), { ok: false, erro: 'Esse pagamento não precisa de conciliação' })
})

test('comForcado de PIX sem valor que entrou (ausente, zero, negativo, texto) recusa com a frase', () => {
  for (const valorRecebido of [undefined, 0, -1, '998', null, { valor: 998 }]) {
    assert.deepEqual(comForcado(PIX_E_DINHEIRO, 0, 'PIX na conta', AUTOR, { valorRecebido, coberto: 0, baseVista: 1000 }),
      { ok: false, erro: 'Informe o valor que entrou na conta' }, String(valorRecebido))
  }
  assert.deepEqual(comForcado(PIX_E_DINHEIRO, 0, 'PIX na conta', AUTOR), { ok: false, erro: 'Informe o valor que entrou na conta' }, 'sem o recebimento')
})

// Decisão do Luis registrada na #92: PIX parcial força só o que falta; custo = o que faltava − o que entrou.
test('comForcado de PIX parcial parte do que falta', () => {
  const r = comForcado(PIX_E_DINHEIRO, 0, 'Resto caiu na conta pessoal', AUTOR, { valorRecebido: 598.8, coberto: 400, baseVista: 600 })
  assert.ok(r.ok)
  assert.deepEqual(r.dados[0].conciliadoManual?.pix, { valorRecebido: 598.8, valorBruto: 600, custoPix: 1.2, custoPixTaxa: 0.002 })
})

test('comForcado de PIX que entrou cheio ou a mais grava custo 0', () => {
  for (const valorRecebido of [1000, 1050]) {
    const r = comForcado(PIX_E_DINHEIRO, 0, 'Caiu na conta pessoal', AUTOR, { valorRecebido, coberto: 0, baseVista: 1000 })
    assert.ok(r.ok)
    assert.deepEqual(r.dados[0].conciliadoManual?.pix, { valorRecebido, valorBruto: 1000, custoPix: 0, custoPixTaxa: 0 })
  }
})

test('comForcado recusa pagamento já forçado (desfaça antes) e PIX que já está coberto', () => {
  const forcado: PgtoOS[] = [{ tipo: 'pix', valor: 1000, conciliadoManual: FORCADO }]
  assert.deepEqual(comForcado(forcado, 0, 'De novo', AUTOR, ENTROU_998),
    { ok: false, erro: 'Este pagamento já foi marcado como recebido. Desfaça antes de marcar de novo.' })
  assert.deepEqual(comForcado(PIX_E_DINHEIRO, 0, 'Coberto', AUTOR, { valorRecebido: 998, coberto: 1000, baseVista: 0 }),
    { ok: false, erro: 'Esse pagamento já está conciliado' })
})

test('comForcado de cartão e financiamento ignora o valor que entrou: a marca é só motivo e autor', () => {
  for (const tipo of ['cartao_credito', 'financiamento']) {
    assert.deepEqual(comForcado([{ tipo, valor: 1000 }], 0, 'Banco depositou', AUTOR, ENTROU_998), {
      ok: true, dados: [{ tipo, valor: 1000, conciliadoManual: { motivo: 'Banco depositou', ...AUTOR } }],
    }, tipo)
  }
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

// ── Custo do PIX (#90): o PIX cobre pelo valor do PIX, não pelo que o banco creditou ──

test('PIX creditado sem o custo cobre o pagamento pelo valor do PIX gravado na conciliação', () => {
  const pgtos: PgtoOS[] = [{ tipo: 'pix', valor: 10000 }]
  const r = matchPagamentos(pgtos, [], [{ id: 'p1', valor: '9980.00', valorBruto: '10000.00' }])
  assert.deepEqual(r, [{ conciliado: true, coberto: 10000, pixId: 'p1' }])
})

test('rateio pelo valor do PIX: dois PIX creditados sem o custo fecham o pagamento', () => {
  const pgtos: PgtoOS[] = [{ tipo: 'pix', valor: 10000 }]
  const r = matchPagamentos(pgtos, [], [{ id: 'p1', valor: 4990, valorBruto: 5000 }, { id: 'p2', valor: 4990, valorBruto: 5000 }])
  assert.deepEqual(r, [{ conciliado: true, coberto: 10000 }])
})

test('PIX vinculado antes do custo (sem valor do PIX gravado) segue cobrindo pelo crédito', () => {
  const pgtos: PgtoOS[] = [{ tipo: 'pix', valor: 10000 }]
  assert.deepEqual(matchPagamentos(pgtos, [], [{ id: 'p1', valor: 10000, valorBruto: null }]), [{ conciliado: true, coberto: 10000, pixId: 'p1' }])
  assert.deepEqual(matchPagamentos(pgtos, [], [{ id: 'p1', valor: 9980, valorBruto: null }]), [{ conciliado: false, coberto: 9980 }])
})

// #90 (tela): a linha mostra o valor do PIX, o custo e o que entrou do PIX que a cobriu inteira.
test('linha coberta por um PIX inteiro diz qual foi; rateio entre PIX e linha sem PIX não dizem', () => {
  const pgtos: PgtoOS[] = [{ tipo: 'pix', valor: 10000 }, { tipo: 'pix', valor: 3000 }, { tipo: 'cartao_credito', valor: 500 }]
  const r = matchPagamentos(pgtos, [], [
    { id: 'inteiro', valor: 9980, valorBruto: 10000 },
    { id: 'parte1', valor: 1497, valorBruto: 1500 },
    { id: 'parte2', valor: 1497, valorBruto: 1500 },
  ])
  assert.deepEqual(r.map(x => x.pixId), ['inteiro', undefined, undefined])
  assert.deepEqual(r.map(x => x.conciliado), [true, true, false])
})

// #92: forçada parcial de PIX. A marca cobre o que faltava; o PIX vinculado fica com esta linha e não cobre outra.
const FORCADA_PARCIAL: ConciliadoManual = { ...FORCADO, pix: { valorRecebido: 5988, valorBruto: 6000, custoPix: 12, custoPixTaxa: 0.002 } }

test('forçada parcial de PIX: o PIX vinculado que completa a linha não cobre outra linha PIX', () => {
  const pgtos: PgtoOS[] = [{ tipo: 'pix', valor: 10000, conciliadoManual: FORCADA_PARCIAL }, { tipo: 'pix', valor: 3000 }]
  const r = matchPagamentos(pgtos, [], [{ id: 'p4', valor: 3992, valorBruto: 4000 }])
  assert.deepEqual(r.map(x => [x.conciliado, x.coberto]), [[true, 10000], [false, 0]])
})

test('forçada parcial de PIX completada por mais de um PIX vinculado: nenhum deles cobre outra linha', () => {
  const pgtos: PgtoOS[] = [{ tipo: 'pix', valor: 10000, conciliadoManual: FORCADA_PARCIAL }, { tipo: 'pix', valor: 3000 }]
  const r = matchPagamentos(pgtos, [], [{ id: 'a', valor: 2000 }, { id: 'b', valor: 2000 }])
  assert.deepEqual(r.map(x => [x.conciliado, x.coberto]), [[true, 10000], [false, 0]])
})

test('PIX a mais que a forçada parcial não usa segue cobrindo outra linha', () => {
  const pgtos: PgtoOS[] = [{ tipo: 'pix', valor: 10000, conciliadoManual: FORCADA_PARCIAL }, { tipo: 'pix', valor: 3000 }]
  const r = matchPagamentos(pgtos, [], [{ id: 'p4', valor: 4000 }, { id: 'p3', valor: 3000 }])
  assert.deepEqual(r.map(x => [x.conciliado, x.coberto]), [[true, 10000], [true, 3000]])
})

test('status nas listas: forçada parcial conta só a base da marca, e o PIX vinculado completa a linha dela', () => {
  const pgtos: PgtoOS[] = [{ tipo: 'pix', valor: 10000, conciliadoManual: FORCADA_PARCIAL }, { tipo: 'pix', valor: 3000 }]
  assert.equal(valorConciliadoManual(pgtos), 6000)
  // 6.000 da marca + 4.000 do PIX vinculado cobrem a linha forçada; a de 3.000 segue sem dinheiro.
  assert.equal(calcStatusMultiPagamento(pgtos, 0, 4000, '13000'), 'parcial')
  assert.equal(calcStatusMultiPagamento(pgtos, 0, 7000, '13000'), 'conciliada')
})

// #92: desvincular recusa só o PIX que completa a forçada parcial.
test('pixCompletaForcadaParcial: só o PIX sem o qual a forçada parcial fica sem o resto', () => {
  const pgtos: PgtoOS[] = [{ tipo: 'pix', valor: 10000, conciliadoManual: FORCADA_PARCIAL }, { tipo: 'pix', valor: 3000 }]
  const pix = [{ id: 'p4', valor: 3992, valorBruto: 4000 }, { id: 'p3', valor: 3000 }]
  assert.equal(pixCompletaForcadaParcial(pgtos, [], pix, 'p4'), true)
  assert.equal(pixCompletaForcadaParcial(pgtos, [], pix, 'p3'), false, 'p3 cobre a outra linha')
  // Com PIX de sobra, nenhum sozinho faz falta.
  assert.equal(pixCompletaForcadaParcial(pgtos, [], [...pix, { id: 'extra', valor: 4000 }], 'p4'), false)
  // Sem forçada parcial, nada prende.
  assert.equal(pixCompletaForcadaParcial([{ tipo: 'pix', valor: 4000 }], [], [{ id: 'p4', valor: 4000 }], 'p4'), false)
})

// #166: a linha pix da maquininha (conciliação de cartão) também pode ser o resto da forçada parcial.
test('pixCompletaForcadaParcial: a linha pix da maquininha que completa a forçada prende; a que cobre outra linha e a de cartão não', () => {
  const pgtos: PgtoOS[] = [{ tipo: 'pix', valor: 10000, conciliadoManual: FORCADA_PARCIAL }, { tipo: 'pix', valor: 3000 }, { tipo: 'cartao_credito', valor: 500 }]
  const maquininha = (id: string, valor: string) => ({ id, autorizacao: null, valorBruto: valor, tipo: 'pix', operadora: 'mercadopago' })
  const linhas = [maquininha('mp4', '4000.00'), maquininha('mp3', '3000.00'), { id: 'cartao', autorizacao: null, valorBruto: '500.00', tipo: 'credito' }]
  assert.equal(pixCompletaForcadaParcial(pgtos, linhas, [], 'mp4'), true)
  assert.equal(pixCompletaForcadaParcial(pgtos, linhas, [], 'mp3'), false, 'mp3 cobre o pagamento de 3.000')
  assert.equal(pixCompletaForcadaParcial(pgtos, linhas, [], 'cartao'), false, 'linha de cartão não cobre PIX')
})

// #51 (PR6c): pagamento que voltou a pendente porque a linha da maquininha foi estornada diz isso (sem o dia: o importador não grava quando estornou).
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
// Com o custo do PIX (#90), o PIX do banco que cobre a linha inteira marca `pixId`; só a linha da maquininha marca a operadora.
test('matchPagamentos: PIX coberto pela linha pix da maquininha guarda a operadora; pelo banco, o pixId', () => {
  const pgtos: PgtoOS[] = [{ tipo: 'pix', valor: 3550 }, { tipo: 'pix', valor: 90 }]
  const linhasDoAlvo = [{ id: 'mp', autorizacao: null, valorBruto: '3550.00', tipo: 'pix', operadora: 'mercadopago' }]
  assert.deepEqual(matchPagamentos(pgtos, linhasDoAlvo, [{ id: 'bco', valor: '90.00' }]), [
    { conciliado: true, coberto: 3550, pixDaMaquininha: 'mercadopago' },
    { conciliado: true, coberto: 90, pixId: 'bco' },
  ])
})

// Decisão do Luis registrada na #92: a tela manda a base que mostrou; se os lançamentos mudaram, o servidor recusa.
test('comForcado de PIX: base que a tela mostrou diferente da do servidor (ou sem ela) recusa, nada grava', () => {
  const mudaram = { ok: false, erro: 'Os lançamentos deste pagamento mudaram. Confira e marque de novo.' }
  assert.deepEqual(comForcado(PIX_E_DINHEIRO, 0, 'Resto caiu', AUTOR, { valorRecebido: 598.8, coberto: 0, baseVista: 600 }), mudaram, 'o PIX que cobria saiu')
  assert.deepEqual(comForcado(PIX_E_DINHEIRO, 0, 'Resto caiu', AUTOR, { valorRecebido: 998, coberto: 400, baseVista: 1000 }), mudaram, 'entrou um PIX')
  for (const baseVista of [undefined, '600', Number.NaN])
    assert.deepEqual(comForcado(PIX_E_DINHEIRO, 0, 'Resto caiu', AUTOR, { valorRecebido: 598.8, coberto: 400, baseVista }), mudaram, String(baseVista))
  assert.equal(comForcado(PIX_E_DINHEIRO, 0, 'Resto caiu', AUTOR, { valorRecebido: 598.8, coberto: 400, baseVista: 600.004 }).ok, true, 'mesma base em centavos')
})

// Desfazer junto com o desvincular (#92): sai só a marca das forçadas parciais que este PIX completa.
const PARCIAL_1500: ConciliadoManual = { ...FORCADO, pix: { valorRecebido: 1497, valorBruto: 1500, custoPix: 3, custoPixTaxa: 0.002 } }
const DUAS_PARCIAIS: PgtoOS[] = [
  { tipo: 'pix', valor: 10000, conciliadoManual: FORCADA_PARCIAL },
  { tipo: 'pix', valor: 2000, conciliadoManual: PARCIAL_1500 },
  { tipo: 'pix', valor: 3000 },
]
const marcadas = (pgtos: PgtoOS[]) => pgtos.map(p => Boolean(p.conciliadoManual))

test('semForcadasQueOPixCompleta: tira só a marca da forçada parcial que este PIX completa', () => {
  const pix = [{ id: 'p4', valor: 4000 }, { id: 'p05', valor: 500 }, { id: 'p3', valor: 3000 }]
  assert.deepEqual(marcadas(semForcadasQueOPixCompleta(DUAS_PARCIAIS, [], pix, 'p4')), [false, true, false])
  assert.deepEqual(marcadas(semForcadasQueOPixCompleta(DUAS_PARCIAIS, [], pix, 'p05')), [true, false, false])
})

test('semForcadasQueOPixCompleta: PIX que não completa forçada nenhuma não muda nada', () => {
  const pix = [{ id: 'p4', valor: 4000 }, { id: 'p05', valor: 500 }, { id: 'p3', valor: 3000 }]
  assert.equal(semForcadasQueOPixCompleta(DUAS_PARCIAIS, [], pix, 'p3'), DUAS_PARCIAIS)
})

test('semForcadasQueOPixCompleta: um PIX que completa as duas forçadas tira as duas marcas', () => {
  const pix = [{ id: 'p45', valor: 4500 }, { id: 'p3', valor: 3000 }]
  assert.deepEqual(marcadas(semForcadasQueOPixCompleta(DUAS_PARCIAIS, [], pix, 'p45')), [false, false, false])
})

// Bot do #189 (B-P1): duas forçadas parciais disputam o mesmo PIX; soltar o PIX não pode deixar nenhuma marca sem dinheiro.
const marcaCom = (valorBruto: number): ConciliadoManual => ({ ...FORCADO, pix: { valorRecebido: valorBruto, valorBruto, custoPix: 0, custoPixTaxa: 0 } })
test('semForcadasQueOPixCompleta: o PIX completa duas forçadas que casam com ele pelo valor; as duas saem', () => {
  const pgtos: PgtoOS[] = [{ tipo: 'pix', valor: 1000, conciliadoManual: marcaCom(900) }, { tipo: 'pix', valor: 500, conciliadoManual: marcaCom(100) }]
  assert.deepEqual(marcadas(semForcadasQueOPixCompleta(pgtos, [], [{ id: 'p', valor: 500 }], 'p')), [false, false])
})

// B-P2: sai a forçada que o PIX completa, não a que outro PIX cobre.
test('semForcadasQueOPixCompleta: tira as forçadas que este PIX completa, não a coberta por outro PIX', () => {
  const pgtos: PgtoOS[] = [
    { tipo: 'pix', valor: 10000, conciliadoManual: marcaCom(5000) },
    { tipo: 'pix', valor: 1000, conciliadoManual: marcaCom(600) },
    { tipo: 'pix', valor: 800, conciliadoManual: marcaCom(500) },
  ]
  const pix = [{ id: 'x', valor: 5000 }, { id: 'p', valor: 700 }]
  assert.deepEqual(marcadas(semForcadasQueOPixCompleta(pgtos, [], pix, 'p')), [true, false, false])
})

// T-M3: forçada cheia (sem a parte pix, ou de cartão) ao lado da parcial fica.
test('semForcadasQueOPixCompleta: forçadas cheias ao lado da parcial ficam', () => {
  const pgtos: PgtoOS[] = [
    { tipo: 'pix', valor: 1000, conciliadoManual: marcaCom(600) },
    { tipo: 'cartao_credito', valor: 500, conciliadoManual: FORCADO },
    { tipo: 'pix', valor: 300, conciliadoManual: FORCADO },
  ]
  assert.deepEqual(marcadas(semForcadasQueOPixCompleta(pgtos, [], [{ id: 'p', valor: 400 }], 'p')), [false, true, true])
})

test('resumoDaForcadaQueOPixCompleta: cada pagamento e quanto foi marcado, e quanto ESTE PIX cobre; null se não completa', () => {
  const pix = [{ id: 'p4', valor: 4000 }, { id: 'p05', valor: 500 }, { id: 'p3', valor: 3000 }]
  assert.deepEqual(resumoDaForcadaQueOPixCompleta(DUAS_PARCIAIS, [], pix, 'p4'), { linhas: [{ valor: 10000, marcado: 6000 }], cobre: 4000 })
  assert.deepEqual(resumoDaForcadaQueOPixCompleta(DUAS_PARCIAIS, [], pix, 'p05'), { linhas: [{ valor: 2000, marcado: 1500 }], cobre: 500 })
  assert.equal(resumoDaForcadaQueOPixCompleta(DUAS_PARCIAIS, [], pix, 'p3'), null)
  // Dois PIX de 2.000 completam a mesma forçada (resto 4.000): cada um cobre 2.000.
  const umaParcial: PgtoOS[] = [{ tipo: 'pix', valor: 10000, conciliadoManual: FORCADA_PARCIAL }]
  assert.deepEqual(resumoDaForcadaQueOPixCompleta(umaParcial, [], [{ id: 'a', valor: 2000 }, { id: 'b', valor: 2000 }], 'a'),
    { linhas: [{ valor: 10000, marcado: 6000 }], cobre: 2000 })
  // Um PIX que completa duas: as duas linhas, separadas.
  assert.deepEqual(resumoDaForcadaQueOPixCompleta(DUAS_PARCIAIS, [], [{ id: 'p45', valor: 4500 }, { id: 'p3', valor: 3000 }], 'p45'),
    { linhas: [{ valor: 10000, marcado: 6000 }, { valor: 2000, marcado: 1500 }], cobre: 4500 })
})

// F1 (#189 r2): sai o mínimo que basta, não o conjunto de soma mais perto do PIX.
test('semForcadasQueOPixCompleta: tira só o que basta (menor soma dos restos), mesmo com um PIX grande', () => {
  // C1: o PIX P de 1.000 e o Q de 400 cobrem os restos de 600 e 400; sem P, tirar a de resto 600 basta.
  const c1: PgtoOS[] = [{ tipo: 'pix', valor: 1000, conciliadoManual: marcaCom(400) }, { tipo: 'pix', valor: 1000, conciliadoManual: marcaCom(600) }]
  assert.deepEqual(marcadas(semForcadasQueOPixCompleta(c1, [], [{ id: 'p', valor: 1000 }, { id: 'q', valor: 400 }], 'p')), [false, true])
  // C2: restos de 300 e 400, P de 5.000 e Q de 400; sem P, tirar uma basta: a de resto menor.
  const c2: PgtoOS[] = [{ tipo: 'pix', valor: 1000, conciliadoManual: marcaCom(700) }, { tipo: 'pix', valor: 1000, conciliadoManual: marcaCom(600) }]
  assert.deepEqual(marcadas(semForcadasQueOPixCompleta(c2, [], [{ id: 'p', valor: 5000 }, { id: 'q', valor: 400 }], 'p')), [false, true])
})
