import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { aprovacaoDoPedido, pecasComPrecoMantido, liquidoPorMoto, valorDaEfetivacao, motivoBloqueioCriarPedido, valoresDaEfetivacao, vendaDoPagamento, motivoBloqueioMotoNoPedido, motosDoPedido, listaDeMotosValida, motosSemRepetir, podeCancelarPedido, trocaDeMotos, valorDaMotoNoPedido, valorDeMotoInvalido, valorDePecaInvalido, podeCriarPedido, podeEfetivarPedido, totalDasPecas, totalDoPedido, valorDaPecaNoPedido } from './pedido-venda-regras'
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

describe('motivoBloqueioMotoNoPedido (#20, Q14)', () => {
  const livre = { status: 'montada', disponibilidade: 'disponivel', lojaId: 'loja-a', arquivadaEm: null }

  test('moto que sumiu ou foi arquivada depois da conferência da action: as frases de sempre', () => {
    assert.equal(motivoBloqueioMotoNoPedido(undefined, 'loja-a', false), 'Moto não encontrada')
    assert.match(motivoBloqueioMotoNoPedido({ ...livre, arquivadaEm: new Date() }, 'loja-a', false)!, /arquivada/i)
  })

  test('moto da loja do pedido, disponível: entra', () => {
    assert.equal(motivoBloqueioMotoNoPedido(livre, 'loja-a', false), null)
  })

  test('moto de outra loja: transferir antes, mesmo que também esteja reservada', () => {
    assert.equal(motivoBloqueioMotoNoPedido({ ...livre, lojaId: 'loja-b' }, 'loja-a', false), 'Só motos da mesma loja no pedido. Transfira a moto antes.')
    assert.equal(motivoBloqueioMotoNoPedido({ ...livre, lojaId: 'loja-b', disponibilidade: 'reservada' }, 'loja-a', false), 'Só motos da mesma loja no pedido. Transfira a moto antes.')
  })

  test('na loja do pedido, segue a regra de criar pedido (reservada, em transporte, transferência)', () => {
    assert.equal(motivoBloqueioMotoNoPedido({ ...livre, disponibilidade: 'reservada' }, 'loja-a', false), 'Moto não está disponível (reservada)')
    assert.equal(motivoBloqueioMotoNoPedido({ ...livre, status: 'em_transporte' }, 'loja-a', false), 'Moto ainda em transporte. Não pode ser vendida.')
    assert.equal(motivoBloqueioMotoNoPedido(livre, 'loja-a', true), 'Moto tem transferência pendente')
  })
})

describe('motosDoPedido (#20)', () => {
  test('moto do pedido primeiro, depois as dos itens na ordem, sem repetir', () => {
    assert.deepEqual(motosDoPedido('m1', [{ motoId: 'm1' }, { motoId: null }, { motoId: 'm2' }, { motoId: 'm3' }]), ['m1', 'm2', 'm3'])
  })

  test('pedido de antes dos itens (#774): só a moto do pedido', () => {
    assert.deepEqual(motosDoPedido('m1', []), ['m1'])
  })
})

describe('trocaDeMotos (#20)', () => {
  test('entra a nova, sai a que não foi pedida; a moto do pedido continua se fica', () => {
    assert.deepEqual(trocaDeMotos(['m1', 'm2'], ['m1', 'm3'], 'm1'), { entram: ['m3'], saem: ['m2'], principal: 'm1' })
  })

  test('saiu a moto do pedido: a 1ª pedida que fica passa a ser ela', () => {
    assert.deepEqual(trocaDeMotos(['m1', 'm2'], ['m2', 'm3'], 'm1'), { entram: ['m3'], saem: ['m1'], principal: 'm2' })
  })

  test('saiu a moto do pedido e a lista põe uma nova na frente: fica a 1ª adicionada antes, não a que acabou de entrar', () => {
    assert.deepEqual(trocaDeMotos(['m1', 'm2'], ['m3', 'm2'], 'm1'), { entram: ['m3'], saem: ['m1'], principal: 'm2' })
  })

  test('lista repetida não entra duas vezes; mesma lista não muda nada', () => {
    assert.deepEqual(trocaDeMotos(['m1'], ['m1', 'm2', 'm2'], 'm1'), { entram: ['m2'], saem: [], principal: 'm1' })
    assert.deepEqual(trocaDeMotos(['m1', 'm2'], ['m2', 'm1'], 'm1'), { entram: [], saem: [], principal: 'm1' })
  })

  test('lista vazia: sem moto do pedido (quem chama recusa)', () => {
    assert.deepEqual(trocaDeMotos(['m1'], [], 'm1'), { entram: [], saem: ['m1'], principal: null })
  })
})

describe('valor da moto no pedido (#20, D-E)', () => {
  test('sem valor: válido e gravado nulo; com valor: duas casas', () => {
    assert.equal(valorDeMotoInvalido(undefined), false)
    assert.equal(valorDaMotoNoPedido(undefined), null)
    assert.equal(valorDaMotoNoPedido(12999.5), '12999.50')
  })

  test('zero, negativo, NaN e infinito não servem', () => {
    for (const v of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) assert.equal(valorDeMotoInvalido(v), true)
  })

  test('na efetivação, o valor em texto (a tela de hoje) passa pela mesma régua da lista', () => {
    for (const v of ['0.004', '1e15', '0', 'abc']) assert.equal(valorDaEfetivacao(v), null, v)
    assert.equal(valorDaEfetivacao('12000.5'), 12000.5)
  })

  test('menos de 1 centavo e acima do que numeric(12,2) guarda não servem; o maior que cabe serve', () => {
    for (const v of [0.004, 1e10, 1e15]) assert.equal(valorDeMotoInvalido(v), true)
    assert.equal(valorDeMotoInvalido(0.01), false)
    assert.equal(valorDeMotoInvalido(9_999_999_999.99), false)
  })

  test('valor de peça (#778): zero serve (brinde, ajuste); acima do que a coluna guarda não', () => {
    assert.equal(valorDePecaInvalido(0), false)
    assert.equal(valorDePecaInvalido(undefined), false)
    for (const v of [-0.01, 1e15, Number.NaN]) assert.equal(valorDePecaInvalido(v), true)
  })

  test('a lista que chega do navegador precisa ser de { motoId: texto, valor?: número }', () => {
    assert.equal(listaDeMotosValida([{ motoId: 'm1' }, { motoId: 'm2', valor: 10 }]), true)
    for (const x of [null, 'm1', {}, [null], [{}], [{ motoId: 1 }], [{ motoId: 'm1', valor: '10' }]]) {
      assert.equal(listaDeMotosValida(x), false, JSON.stringify(x))
    }
  })

  test('moto repetida vale uma vez, com o valor que veio primeiro', () => {
    assert.deepEqual(motosSemRepetir([{ motoId: 'm1', valor: 10 }, { motoId: 'm2' }, { motoId: 'm1', valor: 20 }]), [{ motoId: 'm1', valor: 10 }, { motoId: 'm2' }])
  })
})

describe('efetivar com várias motos (#20, PR B)', () => {
  test('pagamento e frete vão na 1ª venda do CNPJ da loja; sem nenhuma, ou sem frete, na 1ª (D-A, D2 do #779)', () => {
    const motos = [{ outroCnpj: true }, { outroCnpj: false }, { outroCnpj: false }]
    assert.equal(vendaDoPagamento(motos, 300), 1)
    assert.equal(vendaDoPagamento([{ outroCnpj: true }, { outroCnpj: true }], 300), 0)
    assert.equal(vendaDoPagamento(motos, 0), 0)
  })

  test('o líquido se reparte na proporção do valor de cada moto e a soma fecha em centavos (D-C)', () => {
    assert.deepEqual(liquidoPorMoto(20000, [12000, 8000]), [12000, 8000])
    assert.deepEqual(liquidoPorMoto(10000, [1, 1, 1]), [3333.33, 3333.33, 3333.34])
    assert.deepEqual(liquidoPorMoto(500, [700]), [500])
  })

  test('cada moto contra o próprio mínimo; o pagamento sensível vale para o pedido inteiro', () => {
    const motos = [{ motoId: 'a', valor: 12000, minimo: 12000 }, { motoId: 'b', valor: 8000, minimo: 9000 }, { motoId: 'c', valor: 5000, minimo: null }]
    const p = { sensivelSemPermissao: false, papel: 'aux_adm', liquido: 25000, motos }
    const { tipo, abaixo } = aprovacaoDoPedido(p)
    assert.deepEqual([tipo, abaixo], ['valor_minimo', [{ motoId: 'b', minimo: 9000, liquido: 8000 }]])
    assert.equal(aprovacaoDoPedido({ ...p, sensivelSemPermissao: true }).tipo, 'pagamento_sensivel')
    assert.deepEqual([aprovacaoDoPedido({ ...p, papel: 'admin_socio' })].map(a => [a.tipo, a.abaixo]), [[null, []]])
    assert.deepEqual([aprovacaoDoPedido({ ...p, liquido: 28125 })].map(a => [a.tipo, a.abaixo]), [[null, []]])
  })

  test('selo de cada moto na tela (#25): no mínimo ou abaixo, pela mesma conta; sem precificação fica fora; o sócio também vê', () => {
    const motos = [{ motoId: 'a', valor: 12000, minimo: 12000 }, { motoId: 'b', valor: 8000, minimo: 9000 }, { motoId: 'c', valor: 5000, minimo: null }]
    const p = { sensivelSemPermissao: false, papel: 'aux_adm', liquido: 25000, motos }
    const selos = [{ motoId: 'a', minimo: 12000, liquido: 12000, abaixo: false }, { motoId: 'b', minimo: 9000, liquido: 8000, abaixo: true }]
    assert.deepEqual(aprovacaoDoPedido(p).porMoto, selos)
    const socio = aprovacaoDoPedido({ ...p, papel: 'admin_socio' })
    assert.deepEqual([socio.tipo, socio.porMoto], [null, selos])
  })

  test('os valores precisam ser das mesmas motos do pedido, sem faltar nem sobrar; saem na ordem do pedido', () => {
    assert.deepEqual(valoresDaEfetivacao(['a', 'b'], [{ motoId: 'b', valor: 2 }, { motoId: 'a', valor: 1 }]), [{ motoId: 'a', valor: 1 }, { motoId: 'b', valor: 2 }])
    assert.deepEqual(valoresDaEfetivacao(['a'], 10), [{ motoId: 'a', valor: 10 }])
    for (const v of [[{ motoId: 'a', valor: 1 }], [{ motoId: 'a', valor: 1 }, { motoId: 'a', valor: 1 }], [{ motoId: 'a', valor: 1 }, { motoId: 'b', valor: 2 }, { motoId: 'c', valor: 3 }], 10]) {
      assert.equal(valoresDaEfetivacao(['a', 'b'], v), null, JSON.stringify(v))
    }
  })
})

test('editar pedido (#25, decisão 4): quem não ajusta preço mantém o valor do acessório que já estava; peça nova e o valor mandado vão pelo catálogo', () => {
  const atuais = [{ tipo: 'acessorio', pecaId: 'cap', valorUnitario: '200.00' }, { tipo: 'brinde', pecaId: 'ant', valorUnitario: '0.00' }]
  const pedidas = [
    { tipo: 'acessorio' as const, pecaId: 'cap', quantidade: 3, valorUnitario: 1 },
    { tipo: 'acessorio' as const, pecaId: 'luva', quantidade: 1, valorUnitario: 1 },
    { tipo: 'acessorio' as const, pecaId: 'ant', quantidade: 1 },
  ]
  assert.deepEqual(pecasComPrecoMantido(atuais, pedidas), [
    { tipo: 'acessorio', pecaId: 'cap', quantidade: 3, valorUnitario: 200 },
    { tipo: 'acessorio', pecaId: 'luva', quantidade: 1 },
    { tipo: 'acessorio', pecaId: 'ant', quantidade: 1 },
  ])
})
