// Teste de banco: Postgres descartável. Ações do caixa (#153): criar não liga lançamento a venda vinda
// da tela; aprovar, reprovar, excluir e abrir o comprovante só no escopo de quem pede, com a mesma frase
// para outra Conta e inexistente. Fronteira mockada: sessão do Supabase, Next e o Storage.
import { after, before, mock, test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { semearContaBase, semearLoja, semearUsuario, type Base } from '@/test/semear-conta'
import { semearVendaMoto } from '@/test/semear-alvos-conciliacao'
import { semearLancamentoCaixa } from '@/test/semear-despesas'
import { semearModelo } from '@/test/semear-conta'

const url = process.env.TEST_DATABASE_URL
if (!url) throw new Error('TEST_DATABASE_URL não definida — este teste só roda num Postgres descartável')
if (!['localhost', '127.0.0.1'].includes(new URL(url).hostname)) {
  throw new Error('TEST_DATABASE_URL precisa ser loopback (Postgres descartável)')
}
process.env.DATABASE_URL = url

let idDaSessao = ''
let grupoNoCookie: string | null = null
const linksPedidos: string[] = []
const subidos: string[] = []
const apagados: string[] = []
const mocks = [
  mock.module('@/lib/supabase/server', { namedExports: { createClient: async () => ({ auth: {
    getClaims: async () => ({ data: { claims: { sub: idDaSessao, app_metadata: {} } } }),
  } }) } }),
  mock.module('next/headers', { namedExports: { headers: async () => new Headers(),
    cookies: async () => ({ get: (n: string) => (n === 'grupoAtivo' && grupoNoCookie ? { value: grupoNoCookie } : undefined) }) } }),
  mock.module('next/navigation', { namedExports: { redirect: (d: string) => { throw new Error(`redirect ${d}`) }, notFound: () => { throw new Error('notFound') } } }),
  mock.module('next/cache', { namedExports: { revalidatePath: () => {} } }),
  mock.module('@/lib/supabase/admin', { namedExports: { clienteSupabaseAdmin: () => ({ storage: { from: () => ({
    createSignedUrl: async (caminho: string) => { linksPedidos.push(caminho); return { data: { signedUrl: `https://teste.invalid/${caminho}` }, error: null } },
    upload: async (caminho: string) => { subidos.push(caminho); return { error: null } },
    remove: async (caminhos: string[]) => { apagados.push(...caminhos); return { error: null } },
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

// Saída de caixa pendente com comprovante no formato antigo (sem o grupo), gravada direto no banco.
async function saidaPendente(c: Conta) {
  const caminho = `caixa/${randomUUID()}.pdf`
  return { id: await semearLancamentoCaixa(db, { lojaId: c.base.lojaId, usuarioId: c.aux, comprovanteUrl: caminho, data: '2026-11-10' }), caminho }
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

test('guarda: o sócio da própria Conta aprova, reprova e exclui', async () => {
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

test('guarda: admin_geral aprova lançamento de qualquer Conta', async () => {
  const a = await semearConta('A')
  const geral = await semearUsuario(db, a.base, { papel: 'admin_geral', rotulo: `geral-${randomUUID()}`, semLoja: true })
  const s = await saidaPendente(a)
  idDaSessao = geral
  await caixa.aprovarLancamentoAction(s.id)
  assert.deepEqual(await estado(s.id), { s: 'aprovado', por: geral })
})

test('guarda: admin_rede na persona do grupo liberado age nele; noutro grupo da Conta dona, "não encontrado"', async () => {
  const a = await semearConta('A')
  const a2 = await semearConta('A2')
  await linhas(sql`update grupos set conta_id = ${a.base.contaId} where id = ${a2.base.grupoId}`)
  const b = await semearConta('B')
  const geral = await semearUsuario(db, a.base, { papel: 'admin_geral', rotulo: `geral-${randomUUID()}`, semLoja: true })
  const rede = await semearUsuario(db, b.base, { papel: 'admin_rede', rotulo: `rede-${randomUUID()}`, comConta: true })
  await linhas(sql`insert into grupos_liberados (usuario_id, grupo_id, liberado_por) values (${rede}, ${a.base.grupoId}, ${geral})`)
  const doLiberado = await saidaPendente(a)
  const doIrmao = await saidaPendente({ ...a2, base: { ...a2.base, contaId: a.base.contaId } })
  idDaSessao = rede
  grupoNoCookie = a.base.grupoId
  try {
    await caixa.aprovarLancamentoAction(doLiberado.id)
    assert.deepEqual(await estado(doLiberado.id), { s: 'aprovado', por: rede })
    await assert.rejects(caixa.aprovarLancamentoAction(doIrmao.id), /Lançamento não encontrado/)
    assert.deepEqual(await estado(doIrmao.id), { s: 'pendente', por: null })
  } finally { grupoNoCookie = null }
})

test('guarda: aux_adm de outra loja do mesmo grupo não abre o comprovante', async () => {
  const a = await semearConta('A')
  const outraLoja = await semearLoja(db, a.base.grupoId, `CX153 outra ${randomUUID()}`)
  const auxDaOutra = await semearUsuario(db, { ...a.base, lojaId: outraLoja }, { papel: 'aux_adm', rotulo: `aux2-${randomUUID()}`, comConta: true })
  const s = await saidaPendente(a)
  idDaSessao = auxDaOutra
  await assert.rejects(caixa.getComprovanteUrlAction(s.caminho), /Comprovante não encontrado/)
})

const comprovante = () => {
  const fd = new FormData()
  fd.append('file', new File(['%PDF-1.4 teste'], 'recibo.pdf', { type: 'application/pdf' }))
  return fd
}

test('saída com comprovante: o arquivo sobe para a pasta do grupo da loja e a linha guarda esse caminho', async () => {
  const a = await semearConta('A')
  await admin.criarCategoriaCaixa(db, a.base.grupoId, { nome: `${a.categoria} saida`, tipo: 'saida' })
  idDaSessao = a.aux
  subidos.length = 0
  const dados = { lojaId: a.base.lojaId, tipo: 'saida' as const, categoria: `${a.categoria} saida`, valor: '10.00', data: '2026-11-10' }
  assert.deepEqual(await caixa.criarLancamentoAction(dados, comprovante()), { ok: true, dados: undefined })
  assert.equal(subidos.length, 1)
  assert.ok(subidos[0].startsWith(`caixa/${a.base.grupoId}/`), 'caminho com o grupo da loja')
  assert.deepEqual(await linhas(sql`select comprovante_url as c from lancamentos_caixa where categoria = ${`${a.categoria} saida`}`), [{ c: subidos[0] }])
})

test('loja de outra Conta: recusa antes de subir o arquivo', async () => {
  const a = await semearConta('A')
  const b = await semearConta('B')
  idDaSessao = b.socio
  subidos.length = 0
  const dados = { lojaId: a.base.lojaId, tipo: 'saida' as const, categoria: a.categoria, valor: '10.00', data: '2026-11-10' }
  await assert.rejects(caixa.criarLancamentoAction(dados, comprovante()), /Sem permissão para esta loja/)
  assert.deepEqual(subidos, [])
})

test('se a linha não grava, o arquivo que subiu é apagado', async () => {
  const a = await semearConta('A')
  await admin.criarCategoriaCaixa(db, a.base.grupoId, { nome: `${a.categoria} saida`, tipo: 'saida' })
  idDaSessao = a.aux
  subidos.length = 0
  apagados.length = 0
  const dados = { lojaId: a.base.lojaId, tipo: 'saida' as const, categoria: `${a.categoria} saida`, valor: '10.00', data: 'não é data' }
  await assert.rejects(caixa.criarLancamentoAction(dados, comprovante()), /date|data/i)
  assert.equal(subidos.length, 1, 'o arquivo chegou a subir')
  assert.deepEqual(apagados, subidos)
})

test('o mesmo caminho antigo em linhas de duas Contas: cada dono abre o dele (a Conta entra na consulta)', async () => {
  const b = await semearConta('B')
  const a = await semearConta('A')
  const caminho = `caixa/${randomUUID()}.pdf`
  await semearLancamentoCaixa(db, { lojaId: b.base.lojaId, usuarioId: b.aux, comprovanteUrl: caminho })
  await semearLancamentoCaixa(db, { lojaId: a.base.lojaId, usuarioId: a.aux, comprovanteUrl: caminho })
  idDaSessao = a.socio
  assert.equal(await caixa.getComprovanteUrlAction(caminho), `https://teste.invalid/${caminho}`)
})

test('usuário sem Conta não abre comprovante nem aprova: "não encontrado"', async () => {
  const a = await semearConta('A')
  const semConta = await semearUsuario(db, a.base, { papel: 'admin_socio', rotulo: `semconta-${randomUUID()}` })
  const s = await saidaPendente(a)
  idDaSessao = semConta
  await assert.rejects(caixa.getComprovanteUrlAction(s.caminho), /Comprovante não encontrado/)
  await assert.rejects(caixa.aprovarLancamentoAction(s.id), /Lançamento não encontrado/)
})

// Recusa como valor ({ ok: false }) ou lançada: as duas contam, desde que nada suba.
const recusou = async (p: Promise<unknown>) => {
  try { const r = await p as { ok?: boolean }; return r?.ok === false } catch { return true }
}

test('tudo é conferido antes de subir: formato, tamanho, categoria, valor, saída sem arquivo e loja inexistente', async () => {
  const a = await semearConta('A')
  const saida = `${a.categoria} saida`
  await admin.criarCategoriaCaixa(db, a.base.grupoId, { nome: saida, tipo: 'saida' })
  idDaSessao = a.socio
  const base = { lojaId: a.base.lojaId, tipo: 'saida' as const, categoria: saida, valor: '10.00', data: '2026-11-10' }
  const arquivo = (conteudo: BlobPart, tipo: string) => { const fd = new FormData(); fd.append('file', new File([conteudo], 'x', { type: tipo })); return fd }
  subidos.length = 0
  const casos: [string, Promise<unknown>][] = [
    ['formato', caixa.criarLancamentoAction(base, arquivo('texto', 'text/plain'))],
    ['tamanho', caixa.criarLancamentoAction(base, arquivo(new Uint8Array(11 * 1024 * 1024), 'application/pdf'))],
    ['categoria', caixa.criarLancamentoAction({ ...base, categoria: 'não existe' }, comprovante())],
    ['valor', caixa.criarLancamentoAction({ ...base, valor: '0' }, comprovante())],
    ['saída sem arquivo', caixa.criarLancamentoAction(base)],
  ]
  for (const [rotulo, p] of casos) assert.equal(await recusou(p), true, rotulo)
  await assert.rejects(caixa.criarLancamentoAction({ ...base, lojaId: randomUUID() }, comprovante()), /Sem permissão para esta loja/)
  assert.deepEqual(subidos, [])
})
