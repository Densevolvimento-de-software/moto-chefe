// Teste de banco: credencial do Mercado Pago no Editar Grupo (#51, PR5) e recusas que voltam como valor
// (#404). Fronteira simulada: sessão, next/cache e a rede do Mercado Pago (fetch do /users/me); grupo,
// credencial cifrada e transação rodam no Postgres descartável. Conta já ligada a outro grupo: mesma frase e
// nada grava (barrada pela consulta antes do insert; a corrida que cai no índice único não é reproduzida aqui).
import { after, before, beforeEach, mock, test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { semearContaBase, semearUsuario, type Base } from '@/test/semear-conta'

const url = process.env.TEST_DATABASE_URL
if (!url || !['localhost', '127.0.0.1'].includes(new URL(url).hostname)) throw new Error('Use somente Postgres descartável local')
process.env.DATABASE_URL = url
process.env.CERT_MASTER_KEY ??= 'c'.repeat(64)
// A conta da mensalidade vem do shell se estiver exportada; os cenários aqui não dependem dela.
delete process.env.MP_ACCESS_TOKEN

let sessao: Record<string, unknown> = {}
const mocks = [
  mock.module('@/lib/auth', { namedExports: { getUsuarioLogado: async () => sessao } }),
  mock.module('next/cache', { namedExports: { revalidatePath: () => {} } }),
]

// /users/me: cada token responde a sua conta; token desconhecido = 401.
const contasNoMp = new Map<string, { id: number; nickname: string; tags: string[] }>()
let chamadasMp = 0
const fetchOriginal = globalThis.fetch
before(() => {
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    chamadasMp++
    const token = String((init?.headers as Record<string, string>).Authorization).replace('Bearer ', '')
    const conta = contasNoMp.get(token)
    return { ok: !!conta, status: conta ? 200 : 401, json: async () => conta ?? { message: 'unauthorized' } } as Response
  }) as typeof fetch
})

let db: typeof import('@/lib/db')['db']
let execRows: typeof import('@/lib/db')['execRows']
let acoes: typeof import('./actions')
let FRASES_MP: typeof import('@/lib/mercadopago/frases')['FRASES_MP']
before(async () => {
  ;({ db, execRows } = await import('@/lib/db'))
  acoes = await import('./actions')
  ;({ FRASES_MP } = await import('@/lib/mercadopago/frases'))
})
after(async () => {
  globalThis.fetch = fetchOriginal
  for (const m of mocks) m.restore()
  await (globalThis as { __pgPool?: { end(): Promise<void> } }).__pgPool?.end()
})
beforeEach(() => { chamadasMp = 0 })

/** Token novo no MP, de uma conta nova (id único: os arquivos do test:db rodam em paralelo). */
function tokenDeConta(o: { tags?: string[] } = {}) {
  const token = `APP_USR-${randomUUID()}-${randomUUID()}`
  const id = Math.floor(Math.random() * 1e12) + 1e11
  contasNoMp.set(token, { id, nickname: 'LOJA FICTICIA', tags: o.tags ?? ['normal'] })
  return { token, userId: String(id) }
}

async function conta(nome: string): Promise<Base & { adminId: string; auxId: string }> {
  const suf = randomUUID()
  const base = await semearContaBase(db, { prefixo: 'MPCRED', nome: `${nome} ${suf}`, cnpj: suf })
  const adminId = await semearUsuario(db, base, { papel: 'admin_geral' })
  const auxId = await semearUsuario(db, base, { papel: 'aux_adm' })
  return { ...base, adminId, auxId }
}
const comoAdmin = (c: { adminId: string }) => { sessao = { id: c.adminId, papel: 'admin_geral' } }

const dadosDoGrupo = async (grupoId: string) => (await execRows(sql`select nome, cnpj from grupos where id = ${grupoId}`))[0] as { nome: string; cnpj: string }
const editar = async (grupoId: string, extra: Record<string, unknown>) => {
  const g = await dadosDoGrupo(grupoId)
  return acoes.editarGrupoAction(grupoId, { nome: g.nome, cnpj: g.cnpj, ativo: true, ...extra })
}
const config = async (grupoId: string) => (await execRows(sql`select token, user_id, atualizado_por, ultima_importacao_em,
  ultimo_resumo, ultima_falha_em, ultima_falha_erro from mercadopago_config where grupo_id = ${grupoId}`))[0]

test('admin_geral grava o token cifrado e a conta do /users/me; a lista leva só "conectado" e o final', async () => {
  const a = await conta('A')
  comoAdmin(a)
  const { token, userId } = tokenDeConta()
  assert.deepEqual(await editar(a.grupoId, { mpToken: token }), { ok: true, dados: { aviso: null } })
  const c = await config(a.grupoId)
  assert.equal(c.user_id, userId)
  assert.equal(c.atualizado_por, a.adminId)
  assert.notEqual(c.token, token)
  assert.equal(String(c.token).includes(token), false)

  const linha = (await acoes.listarGruposAction()).find(g => g.id === a.grupoId)!
  assert.deepEqual([linha.mpConectado, linha.mpFinal], [true, userId.slice(-3)])
  const serializado = JSON.stringify(linha)
  assert.equal(serializado.includes(userId), false)
  assert.equal(serializado.includes(String(c.token)), false)
})

test('campo vazio mantém a credencial sem chamar o Mercado Pago; remover apaga', async () => {
  const a = await conta('A')
  comoAdmin(a)
  await editar(a.grupoId, { mpToken: tokenDeConta().token })
  const antes = await config(a.grupoId)
  chamadasMp = 0
  assert.deepEqual(await editar(a.grupoId, { mpToken: '' }), { ok: true, dados: { aviso: null } })
  assert.equal(chamadasMp, 0)
  assert.deepEqual(await config(a.grupoId), antes)

  assert.equal((await editar(a.grupoId, { mpRemover: true })).ok, true)
  assert.equal(await config(a.grupoId), undefined)
})

// #891: o servidor não confia no navegador.
test('pedido forjado: conta, autor e grupo saem do servidor, nunca dos campos a mais', async () => {
  const a = await conta('A')
  const b = await conta('B')
  comoAdmin(a)
  const { token, userId } = tokenDeConta()
  const r = await editar(a.grupoId, { mpToken: token, userId: 'forjado', user_id: 'forjado', atualizadoPor: b.adminId, grupoId: b.grupoId })
  assert.equal(r.ok, true)
  const c = await config(a.grupoId)
  assert.deepEqual([c.user_id, c.atualizado_por], [userId, a.adminId])
  assert.equal(await config(b.grupoId), undefined)
})

test('criar grupo com token forjado não grava credencial do Mercado Pago', async () => {
  const a = await conta('A')
  comoAdmin(a)
  const nome = `MPCRED novo ${randomUUID()}`
  const r = await acoes.criarGrupoAction({ nome, cnpj: '00000000000191', ativo: true, mpToken: tokenDeConta().token } as Parameters<typeof acoes.criarGrupoAction>[0])
  assert.deepEqual(r, { ok: true, dados: undefined })
  const [novo] = await execRows(sql`select g.id, c.grupo_id as cfg from grupos g left join mercadopago_config c on c.grupo_id = g.id where g.nome = ${nome}`)
  assert.equal(novo.cfg, null)
  assert.equal(chamadasMp, 0)
})

test('a conta do Mercado Pago já ligada a um grupo de outra Conta: mesma frase, e nada do grupo muda', async () => {
  const a = await conta('A')
  const b = await conta('B')
  comoAdmin(a)
  const { token } = tokenDeConta()
  await editar(b.grupoId, { mpToken: token })
  const r = await acoes.editarGrupoAction(a.grupoId, { nome: 'Nome novo que não grava', cnpj: (await dadosDoGrupo(a.grupoId)).cnpj, ativo: true, mpToken: token })
  assert.deepEqual(r, { ok: false, erro: FRASES_MP.jaLigada })
  assert.notEqual((await dadosDoGrupo(a.grupoId)).nome, 'Nome novo que não grava')
  assert.equal(await config(a.grupoId), undefined)
})

test('token recusado pelo Mercado Pago volta como frase (não como erro lançado) e nada grava', async () => {
  const a = await conta('A')
  comoAdmin(a)
  const r = await editar(a.grupoId, { mpToken: `APP_USR-${randomUUID()}-desconhecido` })
  assert.deepEqual(r, { ok: false, erro: FRASES_MP.recusado })
  assert.equal(await config(a.grupoId), undefined)
})

// #404: com throw, o build de produção troca a frase por "Minified React error #441".
test('recusas de criar e editar voltam como valor: nome vazio, Conta inexistente, grupo inexistente', async () => {
  const a = await conta('A')
  comoAdmin(a)
  const valor = <T,>(p: Promise<T>) => p.catch((e: Error) => ({ lancou: e.message }))
  assert.deepEqual(await valor(acoes.criarGrupoAction({ nome: ' ', cnpj: '1', ativo: true })), { ok: false, erro: 'Nome obrigatório' })
  assert.deepEqual(await valor(acoes.criarGrupoAction({ nome: 'X', cnpj: '1', ativo: true, contaId: randomUUID() })), { ok: false, erro: 'Conta não encontrada' })
  assert.deepEqual(await valor(acoes.editarGrupoAction(a.grupoId, { nome: 'X', cnpj: '', ativo: true })), { ok: false, erro: 'CNPJ obrigatório' })
  chamadasMp = 0
  for (const id of [randomUUID(), 'nao-e-uuid']) {
    assert.deepEqual(await valor(acoes.editarGrupoAction(id, { nome: 'X', cnpj: '1', ativo: true, mpToken: tokenDeConta().token })), { ok: false, erro: 'Grupo não encontrado' })
  }
  assert.equal(chamadasMp, 0)
  assert.deepEqual(await valor(acoes.editarGrupoAction(a.grupoId, { nome: 'X', cnpj: '1', ativo: true, mcpaiEndpointUrl: 'http://x' })),
    { ok: false, erro: 'A chave do mcp.ai precisa ser a URL do endpoint, começando com https://' })
})

test('quem não é admin_geral é recusado no início, sem chamar o Mercado Pago', async () => {
  const a = await conta('A')
  for (const papel of ['aux_adm', 'admin_socio']) {
    sessao = { id: a.auxId, papel }
    assert.deepEqual(await editar(a.grupoId, { mpToken: tokenDeConta().token }), { ok: false, erro: 'Acesso restrito ao Admin Geral' })
  }
  assert.equal(chamadasMp, 0)
  assert.equal(await config(a.grupoId), undefined)
})

test('token novo apaga a falha da última rodada; outra conta apaga também o resumo e a hora', async () => {
  const a = await conta('A')
  comoAdmin(a)
  const primeira = tokenDeConta()
  await editar(a.grupoId, { mpToken: primeira.token })
  const marcarRodadas = () => db.execute(sql`update mercadopago_config set ultima_importacao_em = now(), ultimo_resumo = '{"pendentes":1}'::jsonb,
    ultima_falha_em = now(), ultima_falha_erro = 'falhou' where grupo_id = ${a.grupoId}`)

  // Outro token da mesma conta: o resumo segue, a falha some.
  await marcarRodadas()
  const mesmaConta = `APP_USR-${randomUUID()}-mesma-conta`
  contasNoMp.set(mesmaConta, contasNoMp.get(primeira.token)!)
  await editar(a.grupoId, { mpToken: mesmaConta })
  let c = await config(a.grupoId)
  assert.deepEqual([c.ultimo_resumo, c.ultima_falha_em, c.ultima_falha_erro], [{ pendentes: 1 }, null, null])
  assert.notEqual(c.ultima_importacao_em, null)

  // Conta diferente: nada da antiga fica.
  await marcarRodadas()
  const outra = tokenDeConta()
  await editar(a.grupoId, { mpToken: outra.token })
  c = await config(a.grupoId)
  assert.deepEqual([c.user_id, c.ultima_importacao_em, c.ultimo_resumo, c.ultima_falha_em, c.ultima_falha_erro], [outra.userId, null, null, null, null])
})
