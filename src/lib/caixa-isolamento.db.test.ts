// Teste de banco: Postgres descartável. Ações do caixa (#153): criar não liga lançamento a venda vinda
// da tela; aprovar, reprovar, excluir e abrir o comprovante só no escopo de quem pede, com a mesma frase
// para outra Conta e inexistente. Fronteira mockada: sessão do Supabase, Next e o Storage.
import { after, before, mock, test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { semearContaBase, semearUsuario, type Base } from '@/test/semear-conta'
import { semearVendaMoto } from '@/test/semear-alvos-conciliacao'
import { semearModelo } from '@/test/semear-conta'

const url = process.env.TEST_DATABASE_URL
if (!url) throw new Error('TEST_DATABASE_URL não definida — este teste só roda num Postgres descartável')
if (!['localhost', '127.0.0.1'].includes(new URL(url).hostname)) {
  throw new Error('TEST_DATABASE_URL precisa ser loopback (Postgres descartável)')
}
process.env.DATABASE_URL = url

let idDaSessao = ''
const linksPedidos: string[] = []
const mocks = [
  mock.module('@/lib/supabase/server', { namedExports: { createClient: async () => ({ auth: {
    getClaims: async () => ({ data: { claims: { sub: idDaSessao, app_metadata: {} } } }),
  } }) } }),
  mock.module('next/headers', { namedExports: { headers: async () => new Headers(), cookies: async () => ({ get: () => undefined }) } }),
  mock.module('next/navigation', { namedExports: { redirect: (d: string) => { throw new Error(`redirect ${d}`) }, notFound: () => { throw new Error('notFound') } } }),
  mock.module('next/cache', { namedExports: { revalidatePath: () => {} } }),
  mock.module('@/lib/supabase/admin', { namedExports: { clienteSupabaseAdmin: () => ({ storage: { from: () => ({
    createSignedUrl: async (caminho: string) => { linksPedidos.push(caminho); return { data: { signedUrl: `https://teste.invalid/${caminho}` }, error: null } },
  }) } }) } }),
]

type Db = typeof import('@/lib/db')
let db: Db['db']
let caixa: typeof import('@/app/(dashboard)/caixa/actions')
let admin: typeof import('@/lib/categorias-admin')

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const linhas = async (q: ReturnType<typeof sql>) => ((await db.execute(q)) as unknown as { rows: any[] }).rows

type Conta = { base: Base; socio: string; aux: string; categoria: string }
async function semearConta(nome: string): Promise<Conta> {
  const base = await semearContaBase(db, { prefixo: 'CX153', nome: `${nome}-${randomUUID()}`, cnpj: randomUUID() })
  const socio = await semearUsuario(db, base, { papel: 'admin_socio', rotulo: `socio-${randomUUID()}`, semLoja: true, comGrupo: true, comConta: true })
  const aux = await semearUsuario(db, base, { papel: 'aux_adm', rotulo: `aux-${randomUUID()}`, comConta: true })
  const categoria = `CX153 ${randomUUID()}`
  await admin.criarCategoriaCaixa(db, base.grupoId, { nome: categoria, tipo: 'entrada' })
  return { base, socio, aux, categoria }
}

// Saída de caixa pendente com comprovante, gravada direto no banco (fora da action).
async function saidaPendente(c: Conta) {
  const caminho = `caixa/${randomUUID()}.pdf`
  const [l] = await linhas(sql`insert into lancamentos_caixa (loja_id, usuario_id, tipo, categoria, valor, data, comprovante_url)
    values (${c.base.lojaId}, ${c.aux}, 'saida', 'Outros', '10.00', '2026-11-10', ${caminho}) returning id`)
  return { id: l.id as string, caminho }
}
const estado = async (id: string) =>
  (await linhas(sql`select status_aprovacao as s, aprovado_por_id as por from lancamentos_caixa where id = ${id}`))[0] ?? null

before(async () => {
  ;({ db } = await import('@/lib/db'))
  caixa = await import('@/app/(dashboard)/caixa/actions')
  admin = await import('@/lib/categorias-admin')
})

after(async () => {
  for (const m of mocks) m.restore()
  await (globalThis as { __pgPool?: { end(): Promise<void> } }).__pgPool?.end()
})

test('criar lançamento ignora o vínculo com venda vindo da tela: nada se liga à venda de outra Conta', async () => {
  const a = await semearConta('A')
  const b = await semearConta('B')
  const vendaA = await semearVendaMoto(db, { lojaId: a.base.lojaId, usuarioId: a.aux, modeloId: await semearModelo(db, `CX153 ${randomUUID()}`) }, [{ tipo: 'pix', valor: 100 }])
  idDaSessao = b.aux
  const forjado = { lojaId: b.base.lojaId, tipo: 'entrada' as const, categoria: b.categoria, valor: '10.00', data: '2026-11-10', vendaId: vendaA }
  assert.deepEqual(await caixa.criarLancamentoAction(forjado), { ok: true, dados: undefined })
  assert.deepEqual(await linhas(sql`select venda_id from lancamentos_caixa where categoria = ${b.categoria}`), [{ venda_id: null }])
  assert.deepEqual(await linhas(sql`select count(*)::int as n from lancamentos_caixa where venda_id = ${vendaA}`), [{ n: 0 }])
})

test('guarda: aprovar, reprovar e excluir lançamento de outra Conta ou inexistente: mesma frase e a linha fica', async () => {
  const a = await semearConta('A')
  const b = await semearConta('B')
  const s = await saidaPendente(a)
  idDaSessao = b.socio
  for (const agir of [caixa.aprovarLancamentoAction, caixa.reprovarLancamentoAction, caixa.excluirLancamentoAction]) {
    await assert.rejects(agir(s.id), /Lançamento não encontrado/)
    await assert.rejects(agir(randomUUID()), /Lançamento não encontrado/)
  }
  assert.deepEqual(await estado(s.id), { s: 'pendente', por: null })
})

test('guarda: o sócio da própria Conta aprova, reprova e exclui; o aux_adm de outra loja não', async () => {
  const a = await semearConta('A')
  const s = await saidaPendente(a)
  idDaSessao = a.socio
  await caixa.aprovarLancamentoAction(s.id)
  assert.deepEqual(await estado(s.id), { s: 'aprovado', por: a.socio })
  await caixa.reprovarLancamentoAction(s.id)
  assert.deepEqual(await estado(s.id), { s: 'reprovado', por: a.socio })
  await caixa.excluirLancamentoAction(s.id)
  assert.equal(await estado(s.id), null)
})

test('guarda: link do comprovante de outra Conta ou inexistente: "Comprovante não encontrado"; o da própria Conta abre', async () => {
  const a = await semearConta('A')
  const b = await semearConta('B')
  const s = await saidaPendente(a)
  linksPedidos.length = 0
  for (const quem of [b.socio, b.aux]) {
    idDaSessao = quem
    await assert.rejects(caixa.getComprovanteUrlAction(s.caminho), /Comprovante não encontrado/)
    await assert.rejects(caixa.getComprovanteUrlAction(`caixa/${randomUUID()}.pdf`), /Comprovante não encontrado/)
  }
  assert.deepEqual(linksPedidos, [])
  idDaSessao = a.aux
  assert.equal(await caixa.getComprovanteUrlAction(s.caminho), `https://teste.invalid/${s.caminho}`)
})
