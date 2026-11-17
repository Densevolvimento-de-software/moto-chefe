import { test } from 'node:test'
import assert from 'node:assert/strict'
import { motivoDoErroDeLogin } from './erro-de-login'

test('login bloqueado no Auth (acesso desativado) mostra a frase de conta desativada, não a de senha errada', () => {
  assert.equal(motivoDoErroDeLogin({ name: 'AuthApiError', status: 400, code: 'user_banned' }), 'inativo')
})

test('senha errada continua com a frase de e-mail ou senha', () => {
  assert.equal(motivoDoErroDeLogin({ name: 'AuthApiError', status: 400, code: 'invalid_credentials' }), '1')
})

test('falha de rede ou sem status: serviço indisponível', () => {
  assert.equal(motivoDoErroDeLogin({ name: 'AuthRetryableFetchError', status: 0 }), 'indisponivel')
  assert.equal(motivoDoErroDeLogin({ name: 'AuthApiError' }), 'indisponivel')
})
