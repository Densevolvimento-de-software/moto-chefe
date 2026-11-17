import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { motivoBloqueioCriarPedido, podeCancelarPedido, podeCriarPedido, podeEfetivarPedido, totalDasPecas, totalDoPedido, valorDaPecaNoPedido } from './pedido-venda-regras'
import { entregarSintetico } from '@/test/entrega-sintetica'

const pedido = { status: 'pendente', lojaId: 'loja-a', vendedorId: 'vend-1' }

describe('podeCancelarPedido', () => {
  test('admin geral e sócio cancelam qualquer pedido pendente', () => {
    assert.equal(podeCancelarPedido({ id: 'x', papel: 'admin_geral', lojaId: null }, pedido), true)
    assert.equal(podeCancelarPedido({ id: 'x', papel: 'admin_socio', lojaId: 'loja-b' }, pedido), true)
  })

  test('aux_adm só na própria loja', () => {
    assert.equal(podeCancelarPedido({ id: 'x', papel: 'aux_adm', lojaId: 'loja-a' }, pedido), true)
    assert.equal(podeCancelarPedido({ id: 'x', papel: 'aux_adm', lojaId: 'loja-b' }, pedido), false)
  })

  test('vendedor só o pedido que criou, na própria loja', () => {
    assert.equal(podeCancelarPedido({ id: 'vend-1', papel: 'vendedor', lojaId: 'loja-a' }, pedido), true)
    assert.equal(podeCancelarPedido({ id: 'vend-2', papel: 'vendedor', lojaId: 'loja-a' }, pedido), false)
    assert.equal(podeCancelarPedido({ id: 'vend-1', papel: 'vendedor', lojaId: 'loja-b' }, pedido), false)
  })

  test('mecânico não cancela; pedido não pendente ninguém cancela', () => {
    assert.equal(podeCancelarPedido({ id: 'x', papel: 'mecanico', lojaId: 'loja-a' }, pedido), false)
    assert.equal(podeCancelarPedido({ id: 'x', papel: 'admin_geral', lojaId: null }, { ...pedido, status: 'efetivado' }), false)
  })
})

describe('motivoBloqueioCriarPedido', () => {
  test('montada ou em garantia, disponível e sem transferência: pode', () => {
    assert.equal(motivoBloqueioCriarPedido({ status: 'montada', disponibilidade: 'disponivel' }, false), null)
    assert.equal(motivoBloqueioCriarPedido({ status: 'em_garantia', disponibilidade: 'disponivel' }, false), null)
  })

  test('caixa, em transporte, vendida, reservada, aguardando aprovação ou com transferência: não pode', () => {
    assert.match(motivoBloqueioCriarPedido({ status: 'caixa', disponibilidade: null }, false)!, /montada/)
    assert.equal(motivoBloqueioCriarPedido({ status: 'em_transporte', disponibilidade: 'disponivel' }, false), 'Moto ainda em transporte. Não pode ser vendida.')
    assert.match(motivoBloqueioCriarPedido({ status: 'vendida', disponibilidade: null }, false)!, /vendida/)
    assert.match(motivoBloqueioCriarPedido({ status: 'montada', disponibilidade: 'reservada' }, false)!, /não está disponível/)
    assert.match(motivoBloqueioCriarPedido({ status: 'montada', disponibilidade: 'aguardando_aprovacao' }, false)!, /não está disponível/)
    assert.match(motivoBloqueioCriarPedido({ status: 'montada', disponibilidade: 'disponivel' }, true)!, /transferência/)
  })
})

test('podeCriarPedido: sócios, aux_adm e vendedor criam; mecânico e motorista não', () => {
  for (const p of ['admin_geral', 'admin_socio', 'aux_adm', 'vendedor']) assert.equal(podeCriarPedido(p), true, p)
  for (const p of ['mecanico', 'motorista', '']) assert.equal(podeCriarPedido(p), false, p)
})

test('efetiva (e muda a Entrega na efetivação): admin_geral, admin_socio e aux_adm; vendedor e mecânico não', () => {
  assert.deepEqual(['admin_geral', 'admin_socio', 'aux_adm', 'vendedor', 'mecanico'].map(podeEfetivarPedido), [true, true, true, false, false])
})

test('valorDaPecaNoPedido: brinde sempre R$ 0; acessório ajustado ou o preço do catálogo (#778)', () => {
  assert.equal(valorDaPecaNoPedido({ tipo: 'brinde', pecaId: 'p', quantidade: 1, valorUnitario: 40 }, '40.00'), '0.00')
  assert.equal(valorDaPecaNoPedido({ tipo: 'acessorio', pecaId: 'p', quantidade: 1, valorUnitario: 199.9 }, '250.00'), '199.90')
  assert.equal(valorDaPecaNoPedido({ tipo: 'acessorio', pecaId: 'p', quantidade: 1 }, '250'), '250.00')
  assert.equal(valorDaPecaNoPedido({ tipo: 'acessorio', pecaId: 'p', quantidade: 1, valorUnitario: 0 }, '250.00'), '0.00')
})

test('totalDasPecas: soma quantidade × valor em centavos; brinde (R$ 0) não muda', () => {
  assert.equal(totalDasPecas([{ quantidade: '2.00', valorUnitario: '200.10' }, { quantidade: '1.00', valorUnitario: '0.00' }]), 400.2)
  assert.equal(totalDasPecas([{ quantidade: 3, valorUnitario: 0.1 }]), 0.3)
  assert.equal(totalDasPecas([]), 0)
})

// Quem paga o frete se decide na gravação: `conferirEntrega` só aceita valor com a loja levando ou contratando.
// Aqui, cada caso com a Entrega como ela fica gravada; o total soma o frete gravado, sem reconferir a modalidade.
describe('totalDoPedido: a Entrega gravada de cada caso de quem paga dá o total (#779)', () => {
  const acessorios = [{ quantidade: '2.00', valorUnitario: '150.00' }, { quantidade: '1.00', valorUnitario: '0.00' }]

  test('cliente paga a loja (a loja leva ou contrata, frete gravado): moto + frete + acessórios', () => {
    assert.equal(totalDoPedido(10000, entregarSintetico(350), acessorios), 10650)
    assert.equal(totalDoPedido(10000, entregarSintetico(350, 'ContratacaoPorContaDoRemetente'), []), 10350)
  })

  test('cliente paga a transportadora (FOB, gravada sem frete): só a moto e os acessórios', () => {
    assert.equal(totalDoPedido(10000, entregarSintetico(undefined, 'ContratacaoPorContaDoDestinatario'), acessorios), 10300)
  })

  test('loja paga sem cobrar (a loja leva ou contrata, gravada sem frete): só a moto e os acessórios', () => {
    assert.equal(totalDoPedido(10000, entregarSintetico(undefined, 'ContratacaoPorContaDoRemetente'), acessorios), 10300)
  })

  test('retirada ou pedido sem Entrega: sem frete; soma em centavos, sem resto de float', () => {
    assert.equal(totalDoPedido(10000, { modo: 'retira', modalidade: '' }, []), 10000)
    assert.equal(totalDoPedido(0.1, null, [{ quantidade: 1, valorUnitario: 0.2 }]), 0.3)
  })
})
