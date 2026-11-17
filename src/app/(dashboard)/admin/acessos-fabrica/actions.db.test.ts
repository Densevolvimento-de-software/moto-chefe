// Teste de banco: Postgres descartável. Acessos da fábrica (#3): só o admin_geral (papel principal)
// cria, desativa/reativa e troca a senha do login da fábrica; a linha nasce sem loja, Conta nem
// extras; desativar bloqueia também no Auth; id de outro papel e id inexistente recebem a mesma
// frase e nada muda. Fronteira mockada: sessão, Auth do Supabase (chave de serviço), next/cache.
import { after, before, beforeEach, mock, test } from 'node:test'
import assert from 'node:assert/strict'
import { sql } from 'drizzle-orm'
import { semearContaBase, semearUsuario, type Base } from '@/test/semear-conta'

const url = process.env.TEST_DATABASE_URL
if (!url) throw new Error('TEST_DATABASE_URL não definida — este teste só roda num Postgres descartável')
if (!['localhost', '127.0.0.1'].includes(new URL(url).hostname)) {
  throw new Error('TEST_DATABASE_URL precisa ser loopback (Postgres descartável)')
}
process.env.DATABASE_URL = url

const P = 'ACF3'
let sessao: Record<string, unknown> = {}

// Auth do Supabase: anota cada pedido e pode recusar.
type Pedido = { metodo: string; id?: string; dados?: unknown }
let pedidosAuth: Pedido[] = []
let authRecusa: { criar?: boolean; atualizar?: boolean } = {}
const idsCriados: string[] = []
const authAdmin = {
  createUser: async (dados: unknown) => {
    pedidosAuth.push({ metodo: 'createUser', dados })
    if (authRecusa.criar) return { data: { user: null }, error: new Error('email exists') }
    const id = crypto.randomUUID()
    idsCriados.push(id)
    return { data: { user: { id } }, error: null }
  },
  deleteUser: async (id: string) => { pedidosAuth.push({ metodo: 'deleteUser', id }); return { data: { user: null }, error: null } },
  updateUserById: async (id: string, dados: unknown) => {
    pedidosAuth.push({ metodo: 'updateUserById', id, dados })
    return authRecusa.atualizar ? { data: { user: null }, error: new Error('auth fora') } : { data: { user: { id } }, error: null }
  },
}

const mocks = [
  mock.module('@/lib/auth', { namedExports: {
    getUsuarioLogado: async () => sessao,
    isAdmin: (papel: string) => papel === 'admin_geral',
  } }),
  mock.module('@/lib/supabase/admin', { namedExports: { clienteSupabaseAdmin: () => ({ auth: { admin: authAdmin } }) } }),
  mock.module('next/cache', { namedExports: { revalidatePath: () => {} } }),
]

type Db = typeof import('@/lib/db')
type Acoes = typeof import('./actions')
let db: Db['db']
let acoes: Acoes
let listarAcessosFabrica: typeof import('@/lib/queries/acessos-fabrica')['listarAcessosFabrica']
let contaA: Base
let contaB: Base
const pessoas = {} as Record<'geral' | 'socioA' | 'rede' | 'auxA' | 'auxComGeralExtra' | 'vendedorB' | 'fabrica', { id: string; papel: string; papeisExtras?: string[] }>

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const linhas = async (q: ReturnType<typeof sql>) => ((await db.execute(q)) as unknown as { rows: any[] }).rows
const linhaDe = async (id: string) => (await linhas(sql`
  select papel::text as papel, ativo, loja_id, conta_id, cargo_id, papeis_extras, modulos_extras, grupos_acesso, grupos_aprovacao
  from usuarios where id = ${id}`))[0]
const logsDe = (alvoId: string) => linhas(sql`
  select usuario_id, conta_id, detalhe->>'acao' as acao, detalhe->>'papel' as papel
  from log_acoes where tipo = 'permissao_alterada' and detalhe->>'alvoId' = ${alvoId} order by criado_em`)
let seq = 0
const entrada = (extra: Record<string, unknown> = {}) => ({ nome: `Fábrica ${P} ${++seq}`, email: `acf3-${seq}@teste.invalid`, senha: '12345678', ...extra })

async function criarComoGeral(extra: Record<string, unknown> = {}) {
  sessao = pessoas.geral
  const r = await acoes.criarAcessoFabricaAction(entrada(extra))
  assert.ok(r.ok, JSON.stringify(r))
  return r.dados.id
}

before(async () => {
  ;({ db } = await import('@/lib/db'))
  acoes = await import('./actions')
  ;({ listarAcessosFabrica } = await import('@/lib/queries/acessos-fabrica'))
  contaA = await semearContaBase(db, { prefixo: P, nome: 'A', cnpj: '00000000000301' })
  contaB = await semearContaBase(db, { prefixo: P, nome: 'B', cnpj: '00000000000302' })
  pessoas.geral = { id: await semearUsuario(db, contaA, { papel: 'admin_geral', rotulo: 'geral', semLoja: true }), papel: 'admin_geral' }
  pessoas.socioA = { id: await semearUsuario(db, contaA, { papel: 'admin_socio', rotulo: 'socio' }), papel: 'admin_socio' }
  pessoas.rede = { id: await semearUsuario(db, contaA, { papel: 'admin_rede', rotulo: 'rede' }), papel: 'admin_rede' }
  pessoas.auxA = { id: await semearUsuario(db, contaA, { papel: 'aux_adm', rotulo: 'aux' }), papel: 'aux_adm' }
  pessoas.auxComGeralExtra = { id: await semearUsuario(db, contaA, { papel: 'aux_adm', rotulo: 'aux-extra' }), papel: 'aux_adm', papeisExtras: ['admin_geral'] }
  pessoas.vendedorB = { id: await semearUsuario(db, contaB, { papel: 'vendedor', rotulo: 'vend' }), papel: 'vendedor' }
  pessoas.fabrica = { id: await semearUsuario(db, contaA, { papel: 'fabrica', rotulo: 'fabrica', semLoja: true }), papel: 'fabrica' }
})

beforeEach(() => { pedidosAuth = []; authRecusa = {} })

after(async () => {
  for (const m of mocks) m.restore()
  await (globalThis as { __pgPool?: { end(): Promise<void> } }).__pgPool?.end()
})

test('criar: login no Auth com o papel no app_metadata, sem senha provisória; linha fabrica sem loja, Conta nem extras; log', async () => {
  sessao = pessoas.geral
  const dados = entrada()
  const r = await acoes.criarAcessoFabricaAction(dados)
  assert.ok(r.ok, JSON.stringify(r))
  assert.deepEqual(pedidosAuth, [{ metodo: 'createUser', dados: { email: dados.email, password: dados.senha, email_confirm: true, app_metadata: { papel: 'fabrica' } } }])
  assert.deepEqual(await linhaDe(r.dados.id), {
    papel: 'fabrica', ativo: true, loja_id: null, conta_id: null, cargo_id: null,
    papeis_extras: [], modulos_extras: [], grupos_acesso: [], grupos_aprovacao: [],
  })
  assert.deepEqual(await logsDe(r.dados.id), [{ usuario_id: pessoas.geral.id, conta_id: null, acao: 'criado', papel: 'fabrica' }])
})

test('criar com campos forjados (papel, loja, Conta, módulos, grupos, metadata): só nome, e-mail e senha valem', async () => {
  sessao = pessoas.geral
  const dados = entrada({
    papel: 'admin_geral', lojaId: contaA.lojaId, contaId: contaA.contaId, modulosExtras: ['pix'], gruposAcesso: [contaA.grupoId],
    userMetadata: { must_change_password: true }, appMetadata: { papel: 'admin_geral' },
  })
  const r = await acoes.criarAcessoFabricaAction(dados)
  assert.ok(r.ok, JSON.stringify(r))
  assert.deepEqual(pedidosAuth, [{ metodo: 'createUser', dados: { email: dados.email, password: dados.senha, email_confirm: true, app_metadata: { papel: 'fabrica' } } }])
  const l = await linhaDe(r.dados.id)
  assert.deepEqual([l.papel, l.loja_id, l.conta_id, l.modulos_extras, l.grupos_acesso], ['fabrica', null, null, [], []])
})

test('criar com nome vazio, e-mail inválido ou senha curta: a frase de cada um; o Auth nem é chamado', async () => {
  sessao = pessoas.geral
  assert.deepEqual(await acoes.criarAcessoFabricaAction(entrada({ nome: ' ' })), { ok: false, erro: 'Informe o nome do acesso.' })
  assert.deepEqual(await acoes.criarAcessoFabricaAction(entrada({ email: 'x' })), { ok: false, erro: 'Informe um e-mail válido para o login.' })
  assert.deepEqual(await acoes.criarAcessoFabricaAction(entrada({ senha: '1234567' })), { ok: false, erro: 'A senha deve ter pelo menos 8 caracteres.' })
  assert.deepEqual(pedidosAuth, [])
})

test('criar com e-mail que o Auth recusa: frase neutra e nenhuma linha', async () => {
  sessao = pessoas.geral
  authRecusa = { criar: true }
  const dados = entrada()
  assert.deepEqual(await acoes.criarAcessoFabricaAction(dados),
    { ok: false, erro: 'Não foi possível criar o login com este e-mail. Confira o endereço ou use outro.' })
  assert.equal((await linhas(sql`select 1 from usuarios where email = ${dados.email}`)).length, 0)
})

test('criar quando a linha falha (e-mail já em usuarios): o login sai do Auth', async () => {
  sessao = pessoas.geral
  const dados = entrada()
  await db.execute(sql`insert into usuarios (id, nome, email, papel, ativo) values (gen_random_uuid(), 'Já existe', ${dados.email}, 'fabrica', true)`)
  await assert.rejects(acoes.criarAcessoFabricaAction(dados))
  const criado = pedidosAuth.find(p => p.metodo === 'createUser')
  assert.ok(criado)
  assert.deepEqual(pedidosAuth.filter(p => p.metodo === 'deleteUser').length, 1)
})

test('desativar: ativo false e bloqueio no Auth; reativar desfaz os dois; log de cada um', async () => {
  const id = await criarComoGeral()
  pedidosAuth = []
  assert.deepEqual(await acoes.alternarAcessoFabricaAction(id, false), { ok: true, dados: undefined })
  assert.equal((await linhaDe(id)).ativo, false)
  assert.deepEqual(await acoes.alternarAcessoFabricaAction(id, true), { ok: true, dados: undefined })
  assert.equal((await linhaDe(id)).ativo, true)
  assert.deepEqual(pedidosAuth, [
    { metodo: 'updateUserById', id, dados: { ban_duration: '876000h' } },
    { metodo: 'updateUserById', id, dados: { ban_duration: 'none' } },
  ])
  assert.deepEqual((await logsDe(id)).map(l => l.acao), ['criado', 'desativado', 'ativado'])
})

test('desativar com o Auth fora: frase neutra e o cadastro não muda', async () => {
  const id = await criarComoGeral()
  authRecusa = { atualizar: true }
  assert.deepEqual(await acoes.alternarAcessoFabricaAction(id, false),
    { ok: false, erro: 'Não foi possível mudar o acesso agora. Tente de novo.' })
  assert.equal((await linhaDe(id)).ativo, true)
  assert.deepEqual((await logsDe(id)).map(l => l.acao), ['criado'])
})

test('trocar senha: pelo Auth, com log; senha curta recusada sem chamar o Auth', async () => {
  const id = await criarComoGeral()
  pedidosAuth = []
  assert.deepEqual(await acoes.redefinirSenhaFabricaAction(id, '1234567'), { ok: false, erro: 'A senha deve ter pelo menos 8 caracteres.' })
  assert.deepEqual(pedidosAuth, [])
  assert.deepEqual(await acoes.redefinirSenhaFabricaAction(id, 'nova-senha-1'), { ok: true, dados: undefined })
  assert.deepEqual(pedidosAuth, [{ metodo: 'updateUserById', id, dados: { password: 'nova-senha-1' } }])
  assert.deepEqual((await logsDe(id)).map(l => l.acao), ['criado', 'senha_redefinida'])
})

test('id de usuário de uma Conta (A ou B) e id inexistente: mesma frase, nada muda e o Auth não é chamado', async () => {
  sessao = pessoas.geral
  const NAO_ENCONTRADO = { ok: false, erro: 'Acesso não encontrado' }
  for (const id of [pessoas.auxA.id, pessoas.vendedorB.id, crypto.randomUUID(), 'nem-uuid']) {
    assert.deepEqual(await acoes.alternarAcessoFabricaAction(id, false), NAO_ENCONTRADO, id)
    assert.deepEqual(await acoes.redefinirSenhaFabricaAction(id, 'nova-senha-1'), NAO_ENCONTRADO, id)
  }
  assert.equal((await linhaDe(pessoas.auxA.id)).ativo, true)
  assert.equal((await linhaDe(pessoas.vendedorB.id)).ativo, true)
  assert.deepEqual(pedidosAuth, [])
})

test('só o admin_geral pelo papel principal: sócio da Conta A, admin_rede, aux_adm, admin_geral como papel extra e o próprio login da fábrica são recusados', async () => {
  const id = await criarComoGeral()
  pedidosAuth = []
  for (const p of [pessoas.socioA, pessoas.rede, pessoas.auxA, pessoas.auxComGeralExtra, pessoas.fabrica]) {
    sessao = p
    const recusa = { ok: false, erro: 'Sem permissão' }
    assert.deepEqual(await acoes.criarAcessoFabricaAction(entrada()), recusa, p.papel)
    assert.deepEqual(await acoes.alternarAcessoFabricaAction(id, false), recusa, p.papel)
    assert.deepEqual(await acoes.redefinirSenhaFabricaAction(id, 'nova-senha-1'), recusa, p.papel)
    // O sócio da Conta A também não alcança um usuário da Conta B pelo id.
    assert.deepEqual(await acoes.alternarAcessoFabricaAction(pessoas.vendedorB.id, false), recusa, p.papel)
  }
  assert.equal((await linhaDe(id)).ativo, true)
  assert.deepEqual(pedidosAuth, [])
})

test('a lista traz só logins da fábrica, nenhum usuário de Conta', async () => {
  const id = await criarComoGeral()
  const lista = await listarAcessosFabrica()
  assert.ok(lista.some(a => a.id === id))
  const ids = new Set(lista.map(a => a.id))
  for (const p of Object.values(pessoas).filter(p => p.papel !== 'fabrica')) assert.ok(!ids.has(p.id), p.papel)
  assert.ok(ids.has(pessoas.fabrica.id))
  assert.deepEqual(Object.keys(lista[0]).sort(), ['ativo', 'email', 'id', 'nome'])
})
