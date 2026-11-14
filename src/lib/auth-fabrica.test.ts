// A casca de getUsuarioLogado com o login da fábrica (#901): o papel do token (app_metadata, que o
// middleware usa para prender em /fabrica) e a linha em `usuarios` podem divergir. Sem saída, o
// middleware e as páginas mandavam um para o outro sem fim. Mock só na fronteira (Supabase, Next, banco).
import test, { mock } from 'node:test'
import assert from 'node:assert/strict'

const base = {
  id: 'u1', nome: 'Fábrica', email: 'f@teste.invalid', ativo: true, papel: 'fabrica', lojaId: null, contaId: null, cargoId: null,
  gruposAcesso: [], gruposAprovacao: [], papeisExtras: [], modulosExtras: [], modulosBloqueados: [],
}
let linha: Record<string, unknown> | undefined = base
let papelNoToken: string | undefined = 'fabrica'

mock.module('@/lib/supabase/server', { namedExports: { createClient: async () => ({ auth: {
  getClaims: async () => ({ data: { claims: { sub: 'u1', app_metadata: papelNoToken ? { papel: papelNoToken } : {} } } }),
} }) } })
mock.module('@/lib/db', { namedExports: { db: { select: () => ({ from: () => ({ where: () => ({ limit: async () => (linha ? [linha] : []) }) }) }) } } })
mock.module('next/navigation', { namedExports: { redirect: (destino: string) => { throw new Error(`redirect ${destino}`) } } })
mock.module('next/headers', { namedExports: { cookies: async () => ({ get: () => undefined }), headers: async () => new Headers() } })
mock.module('@/lib/cargos', { namedExports: { cargoDoUsuario: async () => null } })

const entrar = async () => (await import('./auth')).getUsuarioLogado()

test('token e linha de fábrica: entra (leitura de página)', async () => {
  papelNoToken = 'fabrica'; linha = base
  assert.equal((await entrar()).papel, 'fabrica')
})

test('token de fábrica e linha com outro papel: vai para a saída, sem laço', async () => {
  papelNoToken = 'fabrica'; linha = { ...base, papel: 'vendedor', lojaId: 'loja' }
  await assert.rejects(entrar(), /redirect \/conta-desativada/)
})

test('token de fábrica sem linha em usuarios: vai para a saída, não para o /login (que o middleware devolve)', async () => {
  papelNoToken = 'fabrica'; linha = undefined
  await assert.rejects(entrar(), /redirect \/conta-desativada/)
})

test('sem papel no token e sem linha: continua indo para o /login', async () => {
  papelNoToken = undefined; linha = undefined
  await assert.rejects(entrar(), /redirect \/login/)
})
