import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type { PagamentoMp } from './mercadopago/point'
import { classificarPagamento } from './conciliacao-mercadopago'
import credito3x from '@/test/mercadopago-sintetico/credito-3x.json'
import debito from '@/test/mercadopago-sintetico/debito.json'
import pix from '@/test/mercadopago-sintetico/pix.json'
import creditoEstornado from '@/test/mercadopago-sintetico/credito-estornado.json'
import creditoParcial from '@/test/mercadopago-sintetico/credito-parcial.json'
import pendente from '@/test/mercadopago-sintetico/pendente.json'
import linkCheckout from '@/test/mercadopago-sintetico/link-checkout.json'

const pg = (f: unknown, o: Partial<PagamentoMp> = {}): PagamentoMp => ({ ...(f as PagamentoMp), ...o })

describe('classificarPagamento', () => {
  it('crédito 3x aprovado vira cartão', () => {
    const c = classificarPagamento(pg(credito3x))
    assert.equal(c.tipo, 'transacao')
    if (c.tipo !== 'transacao') return
    const t = c.transacao
    assert.equal(t.tipo, 'credito')
    assert.equal(t.parcelas, 3)
    assert.equal(t.valorBruto, credito3x.transaction_amount)
    assert.equal(t.valorLiquido, credito3x.transaction_details.net_received_amount)
    assert.equal(t.nsu, String(credito3x.id))
    assert.equal(t.status, 'aprovado')
    assert.equal(t.rawData?.serial, 'FAKESERIAL01')
    assert.equal(t.rawData?.bandeira, credito3x.payment_method_id)
    assert.equal('payer' in (t.rawData ?? {}), false)
  })

  it('débito vira cartão débito com 1 parcela', () => {
    const c = classificarPagamento(pg(debito))
    assert.equal(c.tipo, 'transacao')
    if (c.tipo !== 'transacao') return
    assert.equal(c.transacao.tipo, 'debito')
    assert.equal(c.transacao.parcelas, 1)
  })

  // Decisão do Luis (#51): o Pix da maquininha entra na conciliação de cartão, como linha tipo pix.
  it('Pix aprovado vira linha tipo pix da conciliação de cartão, sem dado do pagador', () => {
    const c = classificarPagamento(pg(pix))
    assert.equal(c.tipo, 'transacao')
    if (c.tipo !== 'transacao') return
    assert.deepEqual(c.transacao, {
      nsu: String(pix.id),
      autorizacao: undefined,
      dataTransacao: '2026-11-10',
      valorBruto: 80,
      valorLiquido: 79.5,
      parcelas: 1,
      tipo: 'pix',
      status: 'aprovado',
      rawData: { id: pix.id, bandeira: 'pix', serial: 'FAKESERIAL01', ultimos4: null, estornado: 0 },
    })
  })

  it('venda às 23:30 BRT cai no dia de Brasília', () => {
    const c = classificarPagamento(pg(credito3x, { date_approved: '2026-11-13T02:30:00.000Z' }))
    assert.equal(c.tipo, 'transacao')
    if (c.tipo === 'transacao') assert.equal(c.transacao.dataTransacao, '2026-11-12')
  })

  it('refunded e charged_back viram estorno', () => {
    for (const status of ['refunded', 'charged_back']) {
      assert.deepEqual(classificarPagamento(pg(creditoEstornado, { status })), { tipo: 'estorno', chave: String(creditoEstornado.id) })
      assert.deepEqual(classificarPagamento(pg(pix, { status })), { tipo: 'estorno', chave: String(pix.id) })
    }
  })

  it('parcialmente estornado continua cartão aprovado', () => {
    const c = classificarPagamento(pg(creditoParcial))
    assert.equal(c.tipo, 'transacao')
    if (c.tipo !== 'transacao') return
    assert.equal(c.transacao.status, 'aprovado')
    assert.equal(c.transacao.rawData?.estornado, creditoParcial.transaction_amount_refunded)
  })

  it('pagamento sem point_of_interaction de maquininha é ignorado', () => {
    assert.equal(classificarPagamento(pg(linkCheckout)).tipo, 'ignorar')
    assert.equal(classificarPagamento(pg(linkCheckout, { point_of_interaction: undefined })).tipo, 'ignorar')
  })

  // Doc do MP: "Cancelamentos acontecem quando uma compra é realizada mas o pagamento ainda não foi
  // aprovado" (checkout-api-payments/payment-management/cancellations-and-refunds/introduction).
  it('cancelled é ignorado: cancelado antes de aprovar, não houve dinheiro', () => {
    assert.deepEqual(classificarPagamento(pg(credito3x, { status: 'cancelled' })), { tipo: 'ignorar', motivo: 'status cancelled' })
    assert.deepEqual(classificarPagamento(pg(pix, { status: 'cancelled' })), { tipo: 'ignorar', motivo: 'status cancelled' })
  })

  it('pending/in_process é ignorado', () => {
    assert.equal(classificarPagamento(pg(pendente)).tipo, 'ignorar')
    assert.equal(classificarPagamento(pg(credito3x, { status: 'pending' })).tipo, 'ignorar')
  })

  it('crédito à vista vira 1 parcela; installments 0 também vira 1', () => {
    const avista = classificarPagamento(pg(credito3x, { installments: 1 }))
    const zero = classificarPagamento(pg(credito3x, { installments: 0 }))
    assert.equal(avista.tipo === 'transacao' && avista.transacao.parcelas, 1)
    assert.equal(zero.tipo === 'transacao' && zero.transacao.parcelas, 1)
  })

  it('Pix INSTORE sem serial do aparelho é ignorado', () => {
    const semSerial = pg(pix, { point_of_interaction: { type: 'INSTORE' } })
    assert.deepEqual(classificarPagamento(semSerial), { tipo: 'ignorar', motivo: 'não é da maquininha' })
  })

  // Decisão do Luis (#51, opção b): pré-pago não vira linha, mas aparece no resumo da importação.
  it('cartão pré-pago aprovado da maquininha vira "não tratado", não some', () => {
    // Valor e dia de Brasília para a faixa da conciliação; meio fora não entra sozinho depois (a loja usa o Forçar).
    assert.deepEqual(classificarPagamento(pg(debito, { payment_type_id: 'prepaid_card' })),
      { tipo: 'nao_tratado', motivo: 'cartão pré-pago', valor: 150, data: '2026-11-10', entraDepois: false })
  })

  it('cartão pré-pago ainda não aprovado é ignorado', () => {
    assert.deepEqual(classificarPagamento(pg(debito, { payment_type_id: 'prepaid_card', status: 'pending' })), { tipo: 'ignorar', motivo: 'status pending' })
  })

  // Condição do PR4 (#51): linha conciliada sem líquido conta o bruto inteiro como taxa (valor-liquido.ts).
  it('Pix ou cartão aprovado sem valor líquido (ou com líquido 0) vira "não tratado", não linha sem líquido', () => {
    // Sem líquido, entra sozinho numa rodada seguinte se o Mercado Pago mandar o líquido (sem Forçar).
    for (const f of [pix, credito3x, debito]) {
      const naoTratado = { tipo: 'nao_tratado', motivo: 'sem valor líquido', valor: f.transaction_amount, data: '2026-11-10', entraDepois: true }
      assert.deepEqual(classificarPagamento(pg(f, { transaction_details: {} })), naoTratado)
      assert.deepEqual(classificarPagamento(pg(f, { transaction_details: undefined })), naoTratado)
      // Decisão do Luis (#51): líquido 0 tem o mesmo efeito do nulo (o bruto inteiro vira taxa).
      assert.deepEqual(classificarPagamento(pg(f, { transaction_details: { net_received_amount: 0 } })), naoTratado)
    }
  })

  // Decisão do Luis (#51): todo meio aprovado da maquininha fora de crédito, débito e Pix aparece no resumo.
  it('outro meio aprovado da maquininha vira "não tratado" com o nome do meio', () => {
    assert.deepEqual(classificarPagamento(pg(debito, { payment_type_id: 'account_money', payment_method_id: 'account_money' })),
      { tipo: 'nao_tratado', motivo: 'meio account_money', valor: 150, data: '2026-11-10', entraDepois: false })
  })
})
