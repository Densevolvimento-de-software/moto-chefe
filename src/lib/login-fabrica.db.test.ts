// Teste de banco: Postgres descartável. O login da fábrica (#901) só lê: com a sessão dele, uma
// Server Action de verdade chamada por pedido forjado (cabeçalho de action, ou formulário sem o
// cabeçalho) volta ao painel e a linha que ela gravaria (comunicados_lidos) não aparece, sem o
// middleware na frente. O login dele vai direto ao painel e o log de login fica sem grupo; loja e
// Conta gravadas na linha não valem; desativado vai à tela de conta desativada; /admin/usuarios
// não o exclui.
// Fronteira mockada: sessão do Supabase, cabeçalhos e redirect do Next, next/cache.
import { after, before, beforeEach, mock, test } from 'node:test'
import assert from 'node:assert/strict'
import { sql } from 'drizzle-orm'
import { emailDeTeste, semearContaBase, semearUsuario, type Base } from '@/test/semear-conta'

const url = process.env.TEST_DATABASE_URL
if (!url) throw new Error('TEST_DATABASE_URL não definida — este teste só roda num Postgres descartável')
if (!['localhost', '127.0.0.1'].includes(new URL(url).hostname)) {
  throw new Error('TEST_DATABASE_URL precisa ser loopback (Postgres descartável)')
}
process.env.DATABASE_URL = url

const P = 'FAB901'

class Redirecionou extends Error {
  constructor(readonly destino: string) { super(`redirect ${destino}`) }
}
class NaoEncontrado extends Error {}

let idDaSessao = ''
let papelNoToken: string | undefined
let cabecalhos = new Headers()
let entrouComo: { email: string } | null = null
const mocks = [
  mock.module('@/lib/supabase/server', { namedExports: { createClient: async () => ({ auth: {
    getClaims: async () => ({ data: { claims: { sub: idDaSessao, app_metadata: papelNoToken ? { papel: papelNoToken } : {} } } }),
    signInWithPassword: async ({ email }: { email: string }) => {
      entrouComo = { email }
      return { error: null, data: { user: { user_metadata: {} } } }
    },
    signOut: async () => ({ error: null }),
  } }) } }),
  mock.module('next/headers', { namedExports: {
    headers: async () => cabecalhos,
    cookies: async () => ({ get: () => undefined }),
  } }),
  mock.module('next/navigation', { namedExports: {
    redirect: (destino: string) => { throw new Redirecionou(destino) },
    notFound: () => { throw new NaoEncontrado() },
  } }),
  mock.module('next/cache', { namedExports: { revalidatePath: () => {} } }),
  mock.module('@/lib/supabase/admin', { namedExports: { clienteSupabaseAdmin: () => ({ auth: { admin: { deleteUser: async () => ({ error: null }) } } }) } }),
]

type Db = typeof import('@/lib/db')
let db: Db['db']
let marcarComoLidoAction: typeof import('@/app/(dashboard)/admin/comunicados/actions')['marcarComoLidoAction']
let loginAction: typeof import('@/app/(auth)/login/actions')['loginAction']
let getUsuarioLogado: typeof import('@/lib/auth')['getUsuarioLogado']
let excluirUsuarioAction: typeof import('@/app/(dashboard)/admin/usuarios/actions')['excluirUsuarioAction']
let ImprimirDemandaPage: typeof import('@/app/(print)/demandas/[id]/imprimir/page')['default']
let ROTA_PAINEL_FABRICA: string
let PAPEL_FABRICA: string
let base: Base
let fabricaId = ''
let geralId = ''

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const linhas = async (q: ReturnType<typeof sql>) => ((await db.execute(q)) as unknown as { rows: any[] }).rows

async function novoComunicado(): Promise<string> {
  const [c] = await linhas(sql`insert into comunicados (grupo_id, titulo, conteudo)
    values (${base.grupoId}, ${`${P} aviso`}, 'texto') returning id`)
  return c.id
}
const lidos = async (comunicadoId: string, usuarioId: string) =>
  (await linhas(sql`select 1 from comunicados_lidos where comunicado_id = ${comunicadoId} and usuario_id = ${usuarioId}`)).length

async function redirecionaPara(acao: () => Promise<unknown>): Promise<string | null> {
  try { await acao(); return null } catch (e) {
    if (e instanceof Redirecionou) return e.destino
    throw e
  }
}

before(async () => {
  ;({ db } = await import('@/lib/db'))
  ;({ marcarComoLidoAction } = await import('@/app/(dashboard)/admin/comunicados/actions'))
  ;({ loginAction } = await import('@/app/(auth)/login/actions'))
  ;({ getUsuarioLogado } = await import('@/lib/auth'))
  ;({ excluirUsuarioAction } = await import('@/app/(dashboard)/admin/usuarios/actions'))
  ;({ default: ImprimirDemandaPage } = await import('@/app/(print)/demandas/[id]/imprimir/page'))
  ;({ ROTA_PAINEL_FABRICA } = await import('@/lib/painel-fabrica'))
  ;({ PAPEL_FABRICA } = await import('@/lib/login-fabrica'))
  base = await semearContaBase(db, { prefixo: P, nome: 'Rede', cnpj: '00000000901001' })
  fabricaId = await semearUsuario(db, base, { papel: PAPEL_FABRICA, rotulo: 'fabrica', semLoja: true })
  geralId = await semearUsuario(db, base, { papel: 'admin_geral', rotulo: 'geral', semLoja: true })
})

beforeEach(() => { cabecalhos = new Headers(); entrouComo = null; papelNoToken = undefined })

after(async () => {
  for (const m of mocks) m.restore()
  await (globalThis as { __pgPool?: { end(): Promise<void> } }).__pgPool?.end()
})

test('login da fábrica: action chamada com o cabeçalho de action volta ao painel e não grava', async () => {
  idDaSessao = fabricaId
  cabecalhos = new Headers({ 'next-action': 'id-qualquer' })
  const comunicadoId = await novoComunicado()
  assert.equal(await redirecionaPara(() => marcarComoLidoAction(comunicadoId)), ROTA_PAINEL_FABRICA)
  assert.equal(await lidos(comunicadoId, fabricaId), 0)
})

test('login da fábrica: formulário enviado sem o cabeçalho (multipart ou urlencoded) também não grava', async () => {
  idDaSessao = fabricaId
  for (const tipo of ['multipart/form-data; boundary=----x', 'application/x-www-form-urlencoded']) {
    cabecalhos = new Headers({ 'content-type': tipo })
    const comunicadoId = await novoComunicado()
    assert.equal(await redirecionaPara(() => marcarComoLidoAction(comunicadoId)), ROTA_PAINEL_FABRICA, tipo)
    assert.equal(await lidos(comunicadoId, fabricaId), 0, tipo)
  }
})

// A action só marca comunicado do grupo ativo (#940): o controle é um aux_adm da loja do comunicado.
test('controle: a mesma action, pela sessão de um aux_adm do grupo do comunicado, grava', async () => {
  const aux = await semearUsuario(db, base, { papel: 'aux_adm', rotulo: 'aux-controle' })
  idDaSessao = aux
  cabecalhos = new Headers({ 'next-action': 'id-qualquer' })
  const comunicadoId = await novoComunicado()
  assert.equal(await redirecionaPara(() => marcarComoLidoAction(comunicadoId)), null)
  assert.equal(await lidos(comunicadoId, aux), 1)
})

test('login da fábrica entra direto no painel, e o log do login fica sem grupo', async () => {
  const email = emailDeTeste(P, 'Rede', 'fabrica')
  const form = new FormData()
  form.set('email', email)
  form.set('password', 'qualquer')
  assert.equal(await redirecionaPara(() => loginAction(form)), ROTA_PAINEL_FABRICA)
  assert.deepEqual(entrouComo, { email })
  const log = await linhas(sql`select grupo_id from log_acoes where usuario_id = ${fabricaId} and tipo = 'login'`)
  assert.equal(log.length, 1)
  assert.equal(log[0].grupo_id, null)
})

test('login da fábrica com Conta gravada na linha: o log do login fica sem Conta e sem grupo', async () => {
  const id = await semearUsuario(db, base, { papel: PAPEL_FABRICA, rotulo: 'fabrica-login-conta', comConta: true })
  const form = new FormData()
  form.set('email', emailDeTeste(P, 'Rede', 'fabrica-login-conta'))
  form.set('password', 'qualquer')
  assert.equal(await redirecionaPara(() => loginAction(form)), ROTA_PAINEL_FABRICA)
  const log = await linhas(sql`select conta_id, grupo_id from log_acoes where usuario_id = ${id} and tipo = 'login'`)
  assert.deepEqual(log, [{ conta_id: null, grupo_id: null }])
})

// Linha fabrica que alguém gravou com loja e Conta (o ticket D não deixa, mas o banco aceita):
// o servidor não confia nela, e o login da fábrica continua sem loja e sem Conta.
test('login da fábrica com loja e Conta na linha: a sessão sai sem as duas', async () => {
  idDaSessao = await semearUsuario(db, base, { papel: PAPEL_FABRICA, rotulo: 'fabrica-com-loja', comConta: true })
  const u = await getUsuarioLogado()
  assert.equal(u.lojaId, null)
  assert.equal(u.contaId, null)
})

test('login da fábrica com loja na linha não abre o impresso de um registro daquela loja', async () => {
  const solicitante = await semearUsuario(db, base, { papel: 'aux_adm', rotulo: 'aux-da-loja' })
  const [d] = await linhas(sql`insert into demandas (modelo, cor, loja_id, solicitante_id, sinal_recebido, valor_sinal)
    values (${`${P} modelo`}, 'PRETO', ${base.lojaId}, ${solicitante}, true, '100') returning id`)
  const abrir = () => ImprimirDemandaPage({ params: Promise.resolve({ id: d.id }) })

  idDaSessao = solicitante
  await abrir()

  idDaSessao = await semearUsuario(db, base, { papel: PAPEL_FABRICA, rotulo: 'fabrica-loja-impresso' })
  await assert.rejects(abrir(), NaoEncontrado)
})

test('login da fábrica desativado vai para a tela de conta desativada', async () => {
  idDaSessao = await semearUsuario(db, base, { papel: PAPEL_FABRICA, rotulo: 'fabrica-desativada', semLoja: true })
  await db.execute(sql`update usuarios set ativo = false where id = ${idDaSessao}`)
  assert.equal(await redirecionaPara(() => getUsuarioLogado()), '/conta-desativada')
})

test('/admin/usuarios não exclui o login da fábrica, nem o admin_geral: a frase é a de id inexistente', async () => {
  const alvo = await semearUsuario(db, base, { papel: PAPEL_FABRICA, rotulo: 'fabrica-excluir', semLoja: true })
  idDaSessao = geralId
  const recusa = await excluirUsuarioAction(alvo)
  assert.deepEqual(recusa, await excluirUsuarioAction('00000000-0000-4000-8000-000000000902'), 'mesma resposta de id inexistente')
  assert.deepEqual(recusa, { ok: false, erro: 'Usuário não encontrado' })
  assert.equal((await linhas(sql`select 1 from usuarios where id = ${alvo}`)).length, 1)
})

test('token de fábrica com a linha em outro papel, ou sem linha: vai para a tela de acesso indisponível, sem laço', async () => {
  papelNoToken = PAPEL_FABRICA
  idDaSessao = await semearUsuario(db, base, { papel: 'vendedor', rotulo: 'vendedor-token-fabrica' })
  assert.equal(await redirecionaPara(() => getUsuarioLogado()), '/conta-desativada')
  idDaSessao = '00000000-0000-4000-8000-000000000901'
  assert.equal(await redirecionaPara(() => getUsuarioLogado()), '/conta-desativada')
})
