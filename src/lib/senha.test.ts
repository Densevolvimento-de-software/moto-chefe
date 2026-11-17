import { test } from 'node:test'
import assert from 'node:assert/strict'
import { FRASE_SENHA_CURTA, senhaCurta } from './senha'

test('senha com menos de 8 caracteres é curta; com 8 ou mais, não', () => {
  assert.equal(senhaCurta('1234567'), true)
  assert.equal(senhaCurta('12345678'), false)
  assert.equal(FRASE_SENHA_CURTA, 'A senha deve ter pelo menos 8 caracteres.')
})
