import { test } from 'node:test'
import assert from 'node:assert/strict'
import { bloquearLogin } from './bloqueio-login'

// Auth falso: a fronteira de fora. Anota o que pediram e pode recusar.
function authFalso(falha = false) {
  const pedidos: { id: string; atributos: unknown }[] = []
  const auth = {
    updateUserById: async (id: string, atributos: unknown) => {
      pedidos.push({ id, atributos })
      return (falha ? { data: { user: null }, error: new Error('auth fora') } : { data: { user: { id } }, error: null }) as never
    },
  }
  return { auth, pedidos }
}

test('bloquear pede ao Auth um bloqueio sem prazo de volta; desbloquear tira o bloqueio', async () => {
  const { auth, pedidos } = authFalso()
  assert.equal(await bloquearLogin(auth, 'u1', true), true)
  assert.equal(await bloquearLogin(auth, 'u1', false), true)
  assert.deepEqual(pedidos, [
    { id: 'u1', atributos: { ban_duration: '876000h' } },
    { id: 'u1', atributos: { ban_duration: 'none' } },
  ])
})

test('Auth recusa: devolve false', async () => {
  const { auth } = authFalso(true)
  assert.equal(await bloquearLogin(auth, 'u1', true), false)
})
