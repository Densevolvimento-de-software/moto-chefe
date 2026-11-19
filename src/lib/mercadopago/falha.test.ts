import { test } from 'node:test'
import assert from 'node:assert/strict'
import { FALHA_INTERNA, fraseDaFalhaNaTela } from './falha'
import { ErroMercadoPago } from './cliente'
import { FRASES_MP } from './frases'
import { RecusaUsuario } from '@/lib/resultado-action'

// A faixa e o botão mostram a frase da classe do erro; o detalhe técnico (status e caminho) fica no log e no cron.
test('credencial recusada e grupo sem credencial: a frase da própria recusa', () => {
  const recusada = new ErroMercadoPago('O Mercado Pago recusou a credencial deste grupo (HTTP 401). Peça ao administrador para cadastrá-la de novo em Grupos.', 401)
  assert.equal(fraseDaFalhaNaTela(recusada), recusada.message)
  assert.equal(fraseDaFalhaNaTela(new ErroMercadoPago(recusada.message.replace('401', '403'), 403)), recusada.message.replace('401', '403'))
  assert.equal(fraseDaFalhaNaTela(new RecusaUsuario('Este grupo não tem credencial do Mercado Pago.')), 'Este grupo não tem credencial do Mercado Pago.')
})

test('Mercado Pago fora (5xx, 429), tempo esgotado ou rede: "não respondeu agora", sem status nem caminho', () => {
  for (const e of [
    new ErroMercadoPago('Mercado Pago respondeu 503 em /v1/payments/search', 503),
    new ErroMercadoPago('Mercado Pago respondeu 429 em /v1/payments/search', 429),
    new DOMException('The operation was aborted due to timeout', 'TimeoutError'),
    new TypeError('fetch failed'),
  ]) assert.equal(fraseDaFalhaNaTela(e), FRASES_MP.indisponivel)
})

test('qualquer outro erro (banco, inesperado, TypeError que não é de rede): frase fixa de tentar de novo', () => {
  for (const e of [new Error('numeric field overflow'), new TypeError("Cannot read properties of undefined (reading 'id')"), 'texto solto', null]) {
    assert.equal(fraseDaFalhaNaTela(e), FALHA_INTERNA)
  }
})
