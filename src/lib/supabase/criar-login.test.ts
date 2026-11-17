import { test, mock } from 'node:test'
import assert from 'node:assert/strict'
import { criarLoginComCadastro } from './criar-login'

// Auth falso: a fronteira de fora. Anota o que recebeu e o que apagou.
function authFalso(recusa = false, falhaAoApagar = false) {
  const chamadas = { criados: [] as unknown[], apagados: [] as string[] }
  const auth = {
    createUser: async (dados: unknown) => {
      chamadas.criados.push(dados)
      return (recusa ? { data: { user: null }, error: new Error('email exists') } : { data: { user: { id: 'novo' } }, error: null }) as never
    },
    deleteUser: async (id: string) => {
      chamadas.apagados.push(id)
      return { data: { user: null }, error: falhaAoApagar ? new Error('auth fora') : null } as never
    },
  }
  return { auth, chamadas }
}

test('cria no Auth com e-mail confirmado e o metadata pedido, grava o cadastro com o id e devolve o id', async () => {
  const { auth, chamadas } = authFalso()
  const gravados: string[] = []
  const id = await criarLoginComCadastro(auth, { email: 'a@b.co', senha: '12345678', appMetadata: { papel: 'fabrica' } }, async i => { gravados.push(i) })
  assert.equal(id, 'novo')
  assert.deepEqual(gravados, ['novo'])
  assert.deepEqual(chamadas.criados, [{ email: 'a@b.co', password: '12345678', email_confirm: true, app_metadata: { papel: 'fabrica' } }])
  assert.deepEqual(chamadas.apagados, [])
})

test('Auth recusa: devolve null e não grava nada', async () => {
  const { auth } = authFalso(true)
  let gravou = false
  assert.equal(await criarLoginComCadastro(auth, { email: 'a@b.co', senha: '12345678' }, async () => { gravou = true }), null)
  assert.equal(gravou, false)
})

test('a gravação falha: o login sai do Auth e o erro segue', async () => {
  const { auth, chamadas } = authFalso()
  await assert.rejects(criarLoginComCadastro(auth, { email: 'a@b.co', senha: '12345678' }, async () => { throw new Error('falha ao gravar') }), /falha ao gravar/)
  assert.deepEqual(chamadas.apagados, ['novo'])
})

test('o desfazer falha no Auth: registra no log do servidor (sem e-mail nem senha) e o erro da gravação segue', async () => {
  const { auth } = authFalso(false, true)
  const avisos: string[] = []
  const erro = mock.method(console, 'error', (...args: unknown[]) => { avisos.push(args.map(String).join(' ')) })
  try {
    await assert.rejects(criarLoginComCadastro(auth, { email: 'a@b.co', senha: 'senha-secreta' }, async () => { throw new Error('falha ao gravar') }), /falha ao gravar/)
  } finally { erro.mock.restore() }
  assert.equal(avisos.length, 1)
  assert.match(avisos[0], /novo/)
  assert.ok(!avisos[0].includes('a@b.co') && !avisos[0].includes('senha-secreta'))
})
