import { test } from 'node:test'
import assert from 'node:assert/strict'
import { getTransicoesStatusPermitidas, motivoBloqueioPorVenda, motivoBloqueioPedidoAprovacao, motivoBloqueioCancelarReserva, motivoParaNaoVender, motivoParaNaoTransferir, motivoParaNaoAbrirGarantia, avisoVendaBarrada, disponibilidadeAposCancelarReserva, statusLabel, type VendaVinculada } from './estado-moto'

// A venda que estragou a LYDAE3936T1207627: efetivada em 20/08 e já faturada.
const VENDA_FATURADA: VendaVinculada = { numero: 31118, notaFiscalSaida: '2263' }
const VENDA_SEM_NF: VendaVinculada = { numero: 31200, notaFiscalSaida: null }

test('moto vendida não volta a ser montada — o bug da LYDAE3936T1207627', () => {
  // 24/08: a moto foi remontada quatro dias depois de vendida e faturada, e
  // voltou pro Showroom como disponível. Isso tem que ser recusado.
  const motivo = motivoBloqueioPorVenda(VENDA_FATURADA, { status: 'montada' })
  assert.notEqual(motivo, null)
})

test('o motivo cita o número da venda', () => {
  // Sem o número, o operador não sabe o que aconteceu e procura outro caminho
  // pra forçar a montagem — foi exatamente assim que o estado foi corrompido.
  assert.match(motivoBloqueioPorVenda(VENDA_FATURADA, { status: 'montada' })!, /31118/)
})

test('devolver a moto ao showroom como disponível é bloqueado', () => {
  assert.notEqual(motivoBloqueioPorVenda(VENDA_FATURADA, { disponibilidade: 'disponivel' }), null)
})

test('voltar o status para caixa é bloqueado', () => {
  // O passo silencioso de 24/08: 'vendida' → 'caixa' via editarMotoAction.
  assert.notEqual(motivoBloqueioPorVenda(VENDA_FATURADA, { status: 'caixa' }), null)
})

test('moto sem venda é livre para montar', () => {
  assert.equal(motivoBloqueioPorVenda(null, { status: 'montada' }), null)
})

test('editar dados que não são de estoque continua liberado', () => {
  // Corrigir cor/chassi/motor de uma moto vendida é legítimo.
  assert.equal(motivoBloqueioPorVenda(VENDA_FATURADA, {}), null)
})

test('manter o estado vendido é permitido', () => {
  // Não pode travar a própria correção nem a confirmação de NF de saída.
  assert.equal(
    motivoBloqueioPorVenda(VENDA_FATURADA, { status: 'vendida', disponibilidade: 'vendida' }),
    null,
  )
})

test('antes da NF de saída, disponibilidade nula é o estado correto', () => {
  // criarVendaTx deixa status='vendida' + disponibilidade=NULL até a NF sair.
  assert.equal(
    motivoBloqueioPorVenda(VENDA_SEM_NF, { status: 'vendida', disponibilidade: null }),
    null,
  )
})

// ─── Pedido de aprovação de venda ────────────────────────────────────────────

test('moto reservada pode ir para aprovação', () => {
  // Finalizar reserva que precisa de aprovação parte sempre de moto 'reservada'.
  assert.equal(motivoBloqueioPedidoAprovacao({ status: 'montada', disponibilidade: 'reservada' }), null)
})

test('moto disponível pode ir para aprovação', () => {
  assert.equal(motivoBloqueioPedidoAprovacao({ status: 'montada', disponibilidade: 'disponivel' }), null)
})

test('moto na caixa não vai para aprovação', () => {
  assert.notEqual(motivoBloqueioPedidoAprovacao({ status: 'caixa', disponibilidade: null }), null)
})

test('moto vendida não vai para aprovação', () => {
  assert.notEqual(motivoBloqueioPedidoAprovacao({ status: 'vendida', disponibilidade: null }), null)
})

test('moto com pedido pendente não ganha um segundo pedido', () => {
  assert.notEqual(
    motivoBloqueioPedidoAprovacao({ status: 'montada', disponibilidade: 'aguardando_aprovacao' }),
    null,
  )
})

// ─── Cancelamento de reserva ─────────────────────────────────────────────────

test('reserva de moto com venda aguardando aprovação não pode ser cancelada', () => {
  assert.notEqual(motivoBloqueioCancelarReserva({ disponibilidade: 'aguardando_aprovacao' }), null)
})

test('reserva de moto reservada pode ser cancelada', () => {
  assert.equal(motivoBloqueioCancelarReserva({ disponibilidade: 'reservada' }), null)
})

test('reserva de moto disponível pode ser cancelada', () => {
  assert.equal(motivoBloqueioCancelarReserva({ disponibilidade: 'disponivel' }), null)
})

test('reserva de moto na caixa pode ser cancelada', () => {
  assert.equal(motivoBloqueioCancelarReserva({ disponibilidade: null }), null)
})

test('motivoParaNaoVender: a moto na caixa e a em transporte são barradas pelo status, cada uma com a sua frase', () => {
  assert.deepEqual(
    ['caixa', 'em_transporte', 'montada', 'em_garantia', 'vendida'].map(motivoParaNaoVender),
    ['Moto ainda não foi montada. Não pode ser vendida.', 'Moto ainda em transporte. Não pode ser vendida.', null, null, null],
  )
})

test('moto em transporte não vai para aprovação, nem reservada', () => {
  assert.equal(motivoBloqueioPedidoAprovacao({ status: 'em_transporte', disponibilidade: 'reservada' }), 'Moto ainda em transporte. Não pode ser vendida.')
})

test('avisoVendaBarrada: a caixa com o texto de sempre, a em transporte com o seu; a que vende, nenhum', () => {
  assert.deepEqual(avisoVendaBarrada('caixa'), {
    titulo: 'A moto voltou ao estoque, mas ainda está em caixa',
    texto: 'Moto em caixa não pode ser vendida. Use o botão Montar e depois o Vender.',
  })
  assert.deepEqual(avisoVendaBarrada('em_transporte'), {
    titulo: 'A moto voltou ao estoque, mas ainda está em transporte',
    texto: 'Moto em transporte não pode ser vendida. Marque a chegada, monte e depois venda.',
  })
  assert.deepEqual(['montada', 'em_garantia'].map(avisoVendaBarrada), [null, null])
})

test('moto em transporte não tem transição de status nesta etapa, para nenhum papel (a chegada vem no botão Chegou)', () => {
  for (const papel of ['admin_geral', 'admin_socio', 'aux_adm'] as const) {
    assert.deepEqual(getTransicoesStatusPermitidas('em_transporte', papel, true), [], papel)
  }
})

test('motivoParaNaoTransferir: barra a em transporte (marcar a chegada) e a vendida; o resto do estoque transfere', () => {
  assert.deepEqual(
    ['em_transporte', 'vendida', 'caixa', 'montada', 'em_garantia'].map(motivoParaNaoTransferir),
    ['Moto ainda em transporte. Marque a chegada antes de transferir.', 'Moto já foi vendida', null, null, null],
  )
})

// Decisão do Luis (#9): garantia só depois da chegada e da montagem, como a função abrir_garantia do banco.
test('motivoParaNaoAbrirGarantia: barra a em transporte e a caixa, cada uma com a sua frase; montada, em garantia e vendida abrem', () => {
  assert.deepEqual(
    ['em_transporte', 'caixa', 'montada', 'em_garantia', 'vendida'].map(motivoParaNaoAbrirGarantia),
    ['Moto ainda em transporte. Garantia só depois da chegada.', 'Moto ainda não foi montada. Garantia só depois da montagem.', null, null, null],
  )
})

test('disponibilidade depois de cancelar a reserva: nula na caixa e em transporte, "disponivel" no resto', () => {
  assert.deepEqual(
    ['caixa', 'em_transporte', 'montada', 'em_garantia'].map(disponibilidadeAposCancelarReserva),
    [null, null, 'disponivel', 'disponivel'],
  )
})

test('statusLabel: os rótulos dos status de estoque', () => {
  assert.deepEqual(statusLabel, { em_transporte: 'Em transporte', caixa: 'Caixa', montada: 'Montada', em_garantia: 'Garantia' })
})
