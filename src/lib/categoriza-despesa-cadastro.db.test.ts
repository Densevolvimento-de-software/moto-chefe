// Teste de banco: Postgres descartável. A marca "categoriza as saídas do banco" (#149) só o admin_geral
// liga ou desliga em /admin/usuarios; pedido forjado de sócio não muda o que está gravado (#891).
// Fronteira mockada: sessão do Supabase, cabeçalhos e redirect do Next, next/cache, Supabase admin.
import { after, before, mock, test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { semearContaBase, semearUsuario, type Base } from '@/test/semear-conta'

const url = process.env.TEST_DATABASE_URL
if (!url) throw new Error('TEST_DATABASE_URL não definida — este teste só roda num Postgres descartável')
if (!['localhost', '127.0.0.1'].includes(new URL(url).hostname)) {
  throw new Error('TEST_DATABASE_URL precisa ser loopback (Postgres descartável)')
}
process.env.DATABASE_URL = url

let idDaSessao = ''
const mocks = [
  mock.module('@/lib/supabase/server', { namedExports: { createClient: async () => ({ auth: {
    getClaims: async () => ({ data: { claims: { sub: idDaSessao, app_metadata: {} } } }),
  } }) } }),
  mock.module('next/headers', { namedExports: { headers: async () => new Headers(), cookies: async () => ({ get: () => undefined }) } }),
  mock.module('next/navigation', { namedExports: { redirect: (d: string) => { throw new Error(`redirect ${d}`) }, notFound: () => { throw new Error('notFound') } } }),
  mock.module('next/cache', { namedExports: { revalidatePath: () => {} } }),
  mock.module('@/lib/supabase/admin', { namedExports: { clienteSupabaseAdmin: () => ({ auth: { admin: {
    createUser: async () => ({ data: { user: { id: randomUUID() } }, error: null }),
    deleteUser: async () => ({ error: null }),
  } } }) } }),
]

type Db = typeof import('@/lib/db')
let db: Db['db']
let editarUsuarioAction: typeof import('@/app/(dashboard)/admin/usuarios/actions')['editarUsuarioAction']
let criarUsuarioAction: typeof import('@/app/(dashboard)/admin/usuarios/actions')['criarUsuarioAction']
let despesasActions: typeof import('@/app/(dashboard)/despesas/actions')
let admin: typeof import('@/lib/categorias-admin')
let base: Base
let geralId = ''
let socioId = ''
// O editar atualiza o e-mail em auth.users (Supabase); o Postgres descartável não tem esse schema.
let criouAuthUsers = false

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const linhas = async (q: ReturnType<typeof sql>) => ((await db.execute(q)) as unknown as { rows: any[] }).rows
const marca = async (id: string) => (await linhas(sql`select categoriza_despesa_banco as m from usuarios where id = ${id}`))[0].m as boolean

// O formulário de /admin/usuarios para um sócio da loja, com a marca pedida.
async function pedidoDeEdicao(id: string, categorizaDespesaBanco: boolean, nome = 'Sócio da loja') {
  const [u] = await linhas(sql`select email from usuarios where id = ${id}`)
  return {
    nome, email: u.email as string, papel: 'admin_socio', lojaId: base.lojaId, conecta: null,
    gruposAprovacao: [], aprovaPagamentoSensivel: false, gruposAcesso: [], modulosExtras: [], modulosBloqueados: [],
    categorizaDespesaBanco,
  }
}

before(async () => {
  ;({ db } = await import('@/lib/db'))
  ;({ editarUsuarioAction, criarUsuarioAction } = await import('@/app/(dashboard)/admin/usuarios/actions'))
  despesasActions = await import('@/app/(dashboard)/despesas/actions')
  admin = await import('@/lib/categorias-admin')
  const [r] = await linhas(sql`select to_regclass('auth.users') is null as falta`)
  criouAuthUsers = r.falta === true
  if (criouAuthUsers) await db.execute(sql.raw(`create schema if not exists auth;
    create table auth.users (id uuid primary key, email text, email_confirmed_at timestamptz, updated_at timestamptz)`))
  base = await semearContaBase(db, { prefixo: 'CAT149', nome: randomUUID(), cnpj: randomUUID() })
  geralId = await semearUsuario(db, base, { papel: 'admin_geral', rotulo: 'geral', semLoja: true })
  socioId = await semearUsuario(db, base, { papel: 'admin_socio', rotulo: 'socio', semLoja: true, comGrupo: true, comConta: true })
})

after(async () => {
  if (criouAuthUsers) await db.execute(sql.raw('drop table auth.users'))
  for (const m of mocks) m.restore()
  await (globalThis as { __pgPool?: { end(): Promise<void> } }).__pgPool?.end()
})

test('admin_geral liga e desliga a marca de um sócio', async () => {
  const alvo = await semearUsuario(db, base, { papel: 'admin_socio', rotulo: 'alvo-geral', comConta: true })
  idDaSessao = geralId
  assert.deepEqual(await editarUsuarioAction(alvo, await pedidoDeEdicao(alvo, true)), { ok: true })
  assert.equal(await marca(alvo), true)
  assert.deepEqual(await editarUsuarioAction(alvo, await pedidoDeEdicao(alvo, false)), { ok: true })
  assert.equal(await marca(alvo), false)
})

test('sócio não liga nem desliga a marca por pedido forjado; editar outro campo mantém a marca', async () => {
  const marcado = await semearUsuario(db, base, { papel: 'admin_socio', rotulo: 'alvo-marcado', comConta: true })
  const desmarcado = await semearUsuario(db, base, { papel: 'admin_socio', rotulo: 'alvo-desmarcado', comConta: true })
  await linhas(sql`update usuarios set categoriza_despesa_banco = true where id = ${marcado}`)
  idDaSessao = socioId
  assert.deepEqual(await editarUsuarioAction(marcado, await pedidoDeEdicao(marcado, false, 'Nome novo')), { ok: true })
  assert.deepEqual(await linhas(sql`select nome, categoriza_despesa_banco as m from usuarios where id = ${marcado}`), [{ nome: 'Nome novo', m: true }])
  assert.deepEqual(await editarUsuarioAction(desmarcado, await pedidoDeEdicao(desmarcado, true)), { ok: true })
  assert.equal(await marca(desmarcado), false)
})

test('sócio cria usuário com a marca forjada no pedido: nasce sem a marca', async () => {
  idDaSessao = socioId
  const email = `novo-${randomUUID()}@teste.invalid`
  const r = await criarUsuarioAction({ ...(await pedidoDeEdicao(socioId, true)), email, senha: 'senha-forte-123' })
  assert.equal(r.ok, true)
  assert.deepEqual(await linhas(sql`select categoriza_despesa_banco as m from usuarios where email = ${email}`), [{ m: false }])
})

// Saída do extrato do grupo, pendente, para lançar com uma categoria do grupo.
async function saidaPendente() {
  const categoria = `CAT149 ${randomUUID()}`
  await admin.criarCategoriaDespesa(db, base.grupoId, { nome: categoria, contaComoDespesa: true })
  const [o] = await linhas(sql`insert into despesas_open_finance (grupo_id, conta_id, banco, transacao_id, data, valor)
    values (${base.grupoId}, 'c', 'Banco', ${randomUUID()}, '2026-11-10T12:00:00Z'::timestamptz, '30.00') returning id`)
  return { id: o.id as string, categoria }
}

test('com a sessão de verdade: sócio com a marca lança a saída do banco; sem a marca, não', async () => {
  const marcado = await semearUsuario(db, base, { papel: 'admin_socio', rotulo: `marcado-${randomUUID()}`, semLoja: true, comGrupo: true, comConta: true })
  await linhas(sql`update usuarios set categoriza_despesa_banco = true where id = ${marcado}`)
  const s1 = await saidaPendente()
  idDaSessao = marcado
  assert.deepEqual(await despesasActions.lancarDespesaOpenFinanceAction(s1.id, s1.categoria, null), { ok: true, dados: undefined })
  const s2 = await saidaPendente()
  idDaSessao = socioId
  await assert.rejects(despesasActions.lancarDespesaOpenFinanceAction(s2.id, s2.categoria, null), /Sem permissão para categorizar/)
  assert.deepEqual(await linhas(sql`select despesa_id from despesas_open_finance where id = ${s2.id}`), [{ despesa_id: null }])
})

test('com a sessão de verdade: sem a marca, editar e cancelar a categorização também recusam e nada muda', async () => {
  const marcado = await semearUsuario(db, base, { papel: 'admin_socio', rotulo: `marcado2-${randomUUID()}`, semLoja: true, comGrupo: true, comConta: true })
  await linhas(sql`update usuarios set categoriza_despesa_banco = true where id = ${marcado}`)
  const s = await saidaPendente()
  idDaSessao = marcado
  assert.deepEqual(await despesasActions.lancarDespesaOpenFinanceAction(s.id, s.categoria, null), { ok: true, dados: undefined })
  const antes = await linhas(sql`select categoria, despesa_id from despesas_open_finance where id = ${s.id}`)
  idDaSessao = socioId
  await assert.rejects(despesasActions.editarCategorizacaoOpenFinanceAction(s.id, s.categoria, null), /Sem permissão para categorizar/)
  await assert.rejects(despesasActions.cancelarCategorizacaoOpenFinanceAction(s.id), /Sem permissão para categorizar/)
  assert.deepEqual(await linhas(sql`select categoria, despesa_id from despesas_open_finance where id = ${s.id}`), antes)
})
