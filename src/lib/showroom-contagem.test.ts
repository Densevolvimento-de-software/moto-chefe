import { test } from 'node:test'
import assert from 'node:assert/strict'
import { contarCardsDoShowroom } from './showroom-contagem'

const moto = (status: string, disponibilidade: string | null = null) => ({ status, disponibilidade })

test('cards do Showroom: a moto em transporte conta no Total e no próprio card; reservada conta também em Reservadas', () => {
  assert.deepEqual(contarCardsDoShowroom([
    moto('em_transporte'),
    moto('em_transporte', 'reservada'),
    moto('caixa'),
    moto('montada', 'disponivel'),
    moto('em_garantia'),
    moto('vendida'),
  ]), { total: 6, em_transporte: 2, caixa: 1, montada: 1, disponivel: 1, reservada: 1, em_garantia: 1, aguardando_nf: 1 })
})

test('cards do Showroom: sem moto em transporte o card conta 0; lista vazia zera tudo', () => {
  assert.equal(contarCardsDoShowroom([moto('caixa'), moto('montada', 'disponivel')]).em_transporte, 0)
  assert.deepEqual(contarCardsDoShowroom([]), {
    total: 0, em_transporte: 0, caixa: 0, montada: 0, disponivel: 0, reservada: 0, em_garantia: 0, aguardando_nf: 0,
  })
})
