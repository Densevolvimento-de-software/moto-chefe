import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { avisoDeSaldo, comPecas, motosDoEnvio, motosParaAdicionar, motosSemValor, textoDeMaisMotos, pecasDoEnvio, totalDasMotos, totalDasPecasNaTela, type MotoDisponivel } from './novo-pedido'

const moto = (id: string, extra: Partial<MotoDisponivel> = {}): MotoDisponivel =>
  ({ id, chassi: `LA2026X${id}`, marca: 'MC', modelo: 'JET', cor: 'PRETA', lojaId: 'centro', lojaNome: 'Loja Centro', ...extra })
const ids = (r: { motos: { id: string }[] }) => r.motos.map(m => m.id)

describe('motos que o painel oferece (#24)', () => {
  const disponiveis = [moto('4131'), moto('0088', { modelo: 'PITICA', cor: 'BRANCA' }), moto('2217', { lojaId: 'norte', lojaNome: 'Loja Norte' })]

  test('sem moto no pedido: todas as disponíveis, de qualquer loja', () => {
    assert.deepEqual(ids(motosParaAdicionar(disponiveis, { fora: [] }, '')), ['4131', '0088', '2217'])
  })

  test('com a loja do pedido: só as dela, fora as que já estão no pedido', () => {
    assert.deepEqual(ids(motosParaAdicionar(disponiveis, { lojaId: 'centro', fora: ['4131'] }, '')), ['0088'])
  })

  test('loja com muitas motos: a lista mostra até 30 e diz quantas faltam; a busca acha as de fora', () => {
    const muitas = Array.from({ length: 35 }, (_, i) => moto(String(1000 + i)))
    const r = motosParaAdicionar(muitas, { fora: [] }, '')
    assert.deepEqual([r.motos.length, r.mais], [30, 5])
    assert.equal(textoDeMaisMotos(r.mais), 'Mais 5 motos: digite o modelo, a cor ou o final do chassi.')
    assert.deepEqual(ids(motosParaAdicionar(muitas, { fora: [] }, '1034')), ['1034'])
  })

  test('busca por modelo, cor ou final do chassi, sem acento nem caixa', () => {
    assert.deepEqual(ids(motosParaAdicionar(disponiveis, { fora: [] }, 'pitica')), ['0088'])
    assert.deepEqual(ids(motosParaAdicionar(disponiveis, { fora: [] }, 'BRANCA')), ['0088'])
    assert.deepEqual(ids(motosParaAdicionar(disponiveis, { fora: [] }, '2217')), ['2217'])
  })
})

describe('envio e total das motos', () => {
  const noPedido = (id: string, valor: string) => ({ ...moto(id), valor })

  test('na ordem em que entraram; sem valor vai sem o campo (D-E2), com valor vai como número', () => {
    assert.deepEqual(motosDoEnvio([noPedido('4131', '9490.00'), noPedido('0088', '')]), [{ motoId: '4131', valor: 9490 }, { motoId: '0088' }])
  })

  test('valor que o banco não guarda não sai da tela', () => {
    assert.equal(motosDoEnvio([noPedido('4131', '0.00')]), null)
    assert.equal(motosDoEnvio([noPedido('4131', '99999999999.00')]), null)
  })

  test('o total soma só os valores preenchidos, em centavos', () => {
    assert.equal(totalDasMotos([noPedido('4131', '9490.10'), noPedido('0088', '5490.20'), noPedido('2217', '')]), 14980.3)
  })
})

describe('brinde e acessório no pedido (#24, 24b)', () => {
  const capacete = { id: 'cap', nome: 'Capacete', valor: '289.90', quantidadeEstoque: 1 }
  const bau = { id: 'bau', nome: 'Baú', valor: '249.00', quantidadeEstoque: 2 }

  test('acessório entra com o preço do catálogo, brinde sem cobrança; a mesma peça do mesmo tipo soma na quantidade', () => {
    const uma = comPecas([], 'acessorio', [{ peca: capacete, quantidade: 1 }])
    const pecas = comPecas(comPecas(uma, 'acessorio', [{ peca: capacete, quantidade: 1 }]), 'brinde', [{ peca: bau, quantidade: 1 }])
    assert.deepEqual(pecas.map(p => [p.tipo, p.peca.id, p.quantidade, p.valor]), [['acessorio', 'cap', 2, '289.90'], ['brinde', 'bau', 1, '0.00']])
  })

  test('aviso de saldo conta a peça como brinde e como acessório; dentro do saldo, sem aviso', () => {
    const pecas = comPecas(comPecas([], 'acessorio', [{ peca: capacete, quantidade: 1 }]), 'brinde', [{ peca: capacete, quantidade: 1 }, { peca: bau, quantidade: 2 }])
    assert.equal(avisoDeSaldo(pecas, 'cap'), 'Saldo na loja: 1. Fica em -1 depois deste pedido; não trava a venda.')
    assert.equal(avisoDeSaldo(pecas, 'bau'), null)
  })

  test('envio: o valor do acessório só vai de quem gere peças; brinde nunca leva valor; valor que não serve não sai', () => {
    const pecas = comPecas(comPecas([], 'acessorio', [{ peca: capacete, quantidade: 2 }]), 'brinde', [{ peca: bau, quantidade: 1 }])
    const ajustado = pecas.map(p => (p.tipo === 'acessorio' ? { ...p, valor: '250.00' } : p))
    assert.deepEqual(pecasDoEnvio(ajustado, true), [{ tipo: 'acessorio', pecaId: 'cap', quantidade: 2, valorUnitario: 250 }, { tipo: 'brinde', pecaId: 'bau', quantidade: 1 }])
    assert.deepEqual(pecasDoEnvio(ajustado, false), [{ tipo: 'acessorio', pecaId: 'cap', quantidade: 2 }, { tipo: 'brinde', pecaId: 'bau', quantidade: 1 }])
    assert.equal(pecasDoEnvio(pecas.map(p => ({ ...p, valor: '10000000000.00' })), true), null)
  })

  test('acessório com o valor apagado vale o preço do catálogo, no envio e no total (não sai de graça)', () => {
    const apagado = comPecas([], 'acessorio', [{ peca: capacete, quantidade: 2 }]).map(p => ({ ...p, valor: '' }))
    assert.deepEqual(pecasDoEnvio(apagado, true), [{ tipo: 'acessorio', pecaId: 'cap', quantidade: 2 }])
    assert.equal(totalDasPecasNaTela(apagado), 579.8)
  })

  test('total das peças: acessórios pelo valor da tela, brinde R$ 0', () => {
    const pecas = comPecas(comPecas([], 'acessorio', [{ peca: capacete, quantidade: 2 }]), 'brinde', [{ peca: bau, quantidade: 1 }])
    assert.equal(totalDasPecasNaTela(pecas), 579.8)
  })

  test('resumo avisa as motos sem valor (avisa, não bloqueia)', () => {
    const m = (valor: string) => ({ ...moto('1'), valor })
    assert.equal(motosSemValor([m('9490.00')]), null)
    assert.equal(motosSemValor([m(''), m('9490.00')]), '1 moto sem valor')
    assert.equal(motosSemValor([m(''), m('')]), '2 motos sem valor')
  })
})
