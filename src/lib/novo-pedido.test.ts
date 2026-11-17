import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { motosDoEnvio, motosParaAdicionar, totalDasMotos, type MotoDisponivel } from './novo-pedido'

const moto = (id: string, extra: Partial<MotoDisponivel> = {}): MotoDisponivel =>
  ({ id, chassi: `LA2026X${id}`, marca: 'MC', modelo: 'JET', cor: 'PRETA', lojaId: 'centro', lojaNome: 'Loja Centro', ...extra })
const ids = (motos: { id: string }[]) => motos.map(m => m.id)

describe('motos que o painel oferece (#24)', () => {
  const disponiveis = [moto('4131'), moto('0088', { modelo: 'PITICA', cor: 'BRANCA' }), moto('2217', { lojaId: 'norte', lojaNome: 'Loja Norte' })]

  test('sem moto no pedido: todas as disponíveis, de qualquer loja', () => {
    assert.deepEqual(ids(motosParaAdicionar(disponiveis, { fora: [] }, '')), ['4131', '0088', '2217'])
  })

  test('com a loja do pedido: só as dela, fora as que já estão no pedido', () => {
    assert.deepEqual(ids(motosParaAdicionar(disponiveis, { lojaId: 'centro', fora: ['4131'] }, '')), ['0088'])
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
