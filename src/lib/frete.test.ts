// O pedido ao serviço de geocodificação se identifica como o MOVA, não com o e-mail de um cliente (#149).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { NOMINATIM_USER_AGENT } from './frete'
import { CONTRATADA } from './mova-empresa'

test('a identificação enviada ao serviço externo é a do MOVA', () => {
  assert.ok(NOMINATIM_USER_AGENT.includes(CONTRATADA.marca), NOMINATIM_USER_AGENT)
  assert.ok(NOMINATIM_USER_AGENT.includes(`(${CONTRATADA.email})`), NOMINATIM_USER_AGENT)
})
