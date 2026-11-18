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
    assert.equal(c.tipo, 'cartao')
    if (c.tipo !== 'cartao') return
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
    assert.equal(c.tipo, 'cartao')
    if (c.tipo !== 'cartao') return
    assert.equal(c.transacao.tipo, 'debito')
    assert.equal(c.transacao.parcelas, 1)
  })

  it('Pix aprovado vira pix', () => {
    const c = classificarPagamento(pg(pix))
    assert.equal(c.tipo, 'pix')
    if (c.tipo !== 'pix') return
    assert.equal(c.pix.transacaoId, `mp-${pix.id}`)
    assert.equal(c.pix.valor, pix.transaction_amount)
    assert.equal(c.pix.data, pix.date_approved)
    assert.equal(c.pix.serial, 'FAKESERIAL01')
  })

  it('venda às 23:30 BRT cai no dia de Brasília', () => {
    const c = classificarPagamento(pg(credito3x, { date_approved: '2026-11-13T02:30:00.000Z' }))
    assert.equal(c.tipo, 'cartao')
    if (c.tipo === 'cartao') assert.equal(c.transacao.dataTransacao, '2026-11-12')
  })

  it('refunded e charged_back viram estorno', () => {
    for (const status of ['refunded', 'charged_back']) {
      assert.deepEqual(classificarPagamento(pg(creditoEstornado, { status })), {
        tipo: 'estorno', meio: 'cartao', chave: String(creditoEstornado.id),
      })
      assert.deepEqual(classificarPagamento(pg(pix, { status })), {
        tipo: 'estorno', meio: 'pix', chave: `mp-${pix.id}`,
      })
    }
  })

  it('parcialmente estornado continua cartão aprovado', () => {
    const c = classificarPagamento(pg(creditoParcial))
    assert.equal(c.tipo, 'cartao')
    if (c.tipo !== 'cartao') return
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
    assert.equal(avista.tipo === 'cartao' && avista.transacao.parcelas, 1)
    assert.equal(zero.tipo === 'cartao' && zero.transacao.parcelas, 1)
  })

  it('Pix INSTORE sem serial do aparelho é ignorado', () => {
    const semSerial = pg(pix, { point_of_interaction: { type: 'INSTORE' } })
    assert.deepEqual(classificarPagamento(semSerial), { tipo: 'ignorar', motivo: 'não é da maquininha' })
  })
})
