import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SESSAO_ENCERRADA, ehSessaoEncerrada } from './sessao-encerrada'

test('erro com a frase de sessão encerrada é reconhecido', () => {
  assert.equal(ehSessaoEncerrada(new Error(SESSAO_ENCERRADA)), true)
})

test('outro erro, texto solto, nada ou objeto que só imita a mensagem não são sessão encerrada', () => {
  assert.equal(ehSessaoEncerrada(new Error('An unexpected response was received from the server.')), false)
  assert.equal(ehSessaoEncerrada(new Error('Minified React error #441')), false)
  assert.equal(ehSessaoEncerrada(SESSAO_ENCERRADA), false)
  assert.equal(ehSessaoEncerrada(undefined), false)
  assert.equal(ehSessaoEncerrada({ message: SESSAO_ENCERRADA }), false)
})
