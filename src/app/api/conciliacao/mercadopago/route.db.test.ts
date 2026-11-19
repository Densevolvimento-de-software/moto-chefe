// Teste de banco: botão "Importar agora" da /conciliacao (#51, PR6a). Fronteira simulada: sessão, cookie do grupo
// ativo e a rede do Mercado Pago (fetch); grupo ativo, credencial, importação e gravação da faixa rodam no banco.
import { after, before, beforeEach, mock, test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { semearContaBase, semearUsuario } from '@/test/semear-conta'

const url = process.env.TEST_DATABASE_URL
if (!url || !['localhost', '127.0.0.1'].includes(new URL(url).hostname)) throw new Error('Use somente Postgres descartável local')
process.env.DATABASE_URL = url
process.env.CERT_MASTER_KEY ??= 'c'.repeat(64)

let sessao: Record<string, unknown> | null = null
let cookieGrupo: string | undefined
const mocks = [
  mock.module('@/lib/auth', { namedExports: { getUsuarioLogado: async () => { if (!sessao) throw new Error('sem sessão'); return sessao } } }),
  mock.module('next/headers', { namedExports: { cookies: async () => ({ get: (n: string) => (n === 'grupoAtivo' && cookieGrupo ? { value: cookieGrupo } : undefined) }) } }),
]

// /v1/payments/search: cada token responde a sua lista; token sem resposta = 401.
const respostasMp = new Map<string, { status: number; results?: unknown[] }>()
const fetchOriginal = globalThis.fetch
before(() => {
  globalThis.fetch = (async (_u: unknown, init?: RequestInit) => {
    const token = String((init?.headers as Record<string, string>).Authorization).replace('Bearer ', '')
    const r = respostasMp.get(token) ?? { status: 401 }
    return { ok: r.status === 200, status: r.status, json: async () => ({ paging: { total: r.results?.length ?? 0 }, results: r.results ?? [] }) } as Response
  }) as typeof fetch
})

let db: typeof import('@/lib/db')['db']
let execRows: typeof import('@/lib/db')['execRows']
let cifrar: typeof import('@/lib/cripto')['cifrar']
let POST: typeof import('./route')['POST']
before(async () => {
  ;({ db, execRows } = await import('@/lib/db'))
  ;({ cifrar } = await import('@/lib/cripto'))
  ;({ POST } = await import('./route'))
})
after(async () => {
  globalThis.fetch = fetchOriginal
  for (const m of mocks) m.restore()
  await (globalThis as { __pgPool?: { end(): Promise<void> } }).__pgPool?.end()
})
beforeEach(() => { sessao = null; cookieGrupo = undefined })

async function conta(nome: string, { credencial = 200 as number | null } = {}) {
  const suf = randomUUID()
  const base = await semearContaBase(db, { prefixo: 'MPROTA', nome: `${nome} ${suf}`, cnpj: suf })
  const aux = await semearUsuario(db, base, { papel: 'aux_adm' })
  const vendedor = await semearUsuario(db, base, { papel: 'vendedor' })
  const socio = await semearUsuario(db, base, { papel: 'admin_socio' })
  const token = `TEST-${suf}`
  if (credencial !== null) {
    await db.execute(sql`insert into mercadopago_config (grupo_id, token, user_id) values (${base.grupoId}, ${cifrar(token)}, ${'mp-' + suf})`)
    respostasMp.set(token, { status: credencial, results: [] })
  }
  const como = (id: string, papel: string) => ({ id, papel, lojaId: base.lojaId, contaId: base.contaId, gruposAcesso: [], papeisExtras: [], modulosExtras: [] })
  return { ...base, comoAux: como(aux, 'aux_adm'), comoVendedor: como(vendedor, 'vendedor'), comoSocio: como(socio, 'admin_socio') }
}
const faixa = async (grupoId: string) => (await execRows(sql`select ultima_importacao_em, ultima_falha_erro from mercadopago_config where grupo_id = ${grupoId}`))[0]
const chamar = async () => { const r = await POST(); return { status: r.status, corpo: await r.json() } }

test('sem sessão: 401 com { error }', async () => {
  assert.deepEqual(await chamar(), { status: 401, corpo: { error: 'Sessão expirada' } })
})

test('vendedor (sem gerir a conciliação): 403 com { error }, e nada importa', async () => {
  const a = await conta('A')
  sessao = a.comoVendedor
  assert.deepEqual(await chamar(), { status: 403, corpo: { error: 'Sem permissão' } })
  assert.equal((await faixa(a.grupoId)).ultima_importacao_em, null)
})

test('aux_adm importa o grupo da loja dele', async () => {
  const a = await conta('A')
  sessao = a.comoAux
  assert.deepEqual(await chamar(), { status: 200, corpo: { ok: true } })
  assert.notEqual((await faixa(a.grupoId)).ultima_importacao_em, null)
})

// O sócio escolhe o grupo ativo pelo cookie: o de outra Conta não vale, e cai no da loja dele.
test('admin_socio com o cookie apontando o grupo de outra Conta importa o próprio grupo, não o outro', async () => {
  const a = await conta('A')
  const b = await conta('B')
  sessao = a.comoSocio
  cookieGrupo = b.grupoId
  assert.deepEqual(await chamar(), { status: 200, corpo: { ok: true } })
  assert.notEqual((await faixa(a.grupoId)).ultima_importacao_em, null)
  assert.equal((await faixa(b.grupoId)).ultima_importacao_em, null)
})

test('admin_geral importa o grupo escolhido no seletor', async () => {
  const a = await conta('A')
  const b = await conta('B')
  sessao = { ...a.comoAux, papel: 'admin_geral' }
  cookieGrupo = b.grupoId
  assert.deepEqual(await chamar(), { status: 200, corpo: { ok: true } })
  assert.notEqual((await faixa(b.grupoId)).ultima_importacao_em, null)
  assert.equal((await faixa(a.grupoId)).ultima_importacao_em, null)
})

// A tela só lê { error }: um 500 em HTML viraria "falha ao falar com o servidor".
test('erro ao achar o grupo ativo (usuário sem loja): { error } com frase fixa, sem lançar', async t => {
  t.mock.method(console, 'error', () => {})
  const a = await conta('A')
  sessao = { ...a.comoAux, lojaId: null }
  assert.deepEqual(await chamar(), { status: 500, corpo: { error: 'Não deu para importar. Tente de novo em alguns minutos.' } })
})

test('Mercado Pago recusa a credencial: { error } com a frase conhecida, e a falha fica gravada no grupo', async () => {
  const a = await conta('A', { credencial: 401 })
  sessao = a.comoAux
  const frase = 'O Mercado Pago recusou a credencial deste grupo (HTTP 401). Peça ao administrador para cadastrá-la de novo em Grupos.'
  assert.deepEqual(await chamar(), { status: 502, corpo: { error: frase } })
  assert.equal((await faixa(a.grupoId)).ultima_falha_erro, frase)
})

test('grupo sem credencial: { error } com a frase', async () => {
  const a = await conta('A', { credencial: null })
  sessao = a.comoAux
  assert.deepEqual(await chamar(), { status: 502, corpo: { error: 'Este grupo não tem credencial do Mercado Pago.' } })
})
