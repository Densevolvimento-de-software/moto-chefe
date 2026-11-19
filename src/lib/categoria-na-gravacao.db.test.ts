// Teste de banco: Postgres descartável, como src/lib/categorias-do-grupo.db.test.ts.
// As actions que gravam despesa e lançamento de caixa conferem a categoria no grupo (#834): o sócio da
// Conta B não grava com a categoria da Conta A. Fronteira mockada: sessão, cookies e next/cache.
// As actions usam o db global, então os dados ficam gravados e o after apaga pelo grupo do teste.
import { after, before, mock, test } from 'node:test'
import assert from 'node:assert/strict'
import { sql } from 'drizzle-orm'
import { semearContaBase, semearUsuario, type Base } from '@/test/semear-conta'
import { semearDespesa, semearSaidaDoExtrato } from '@/test/semear-despesas'

const url = process.env.TEST_DATABASE_URL
if (!url) throw new Error('TEST_DATABASE_URL não definida — este teste só roda num Postgres descartável')
if (!['localhost', '127.0.0.1'].includes(new URL(url).hostname)) {
  throw new Error('TEST_DATABASE_URL precisa ser loopback (Postgres descartável)')
}
process.env.DATABASE_URL = url

type Usuario = typeof import('@/lib/db/schema')['usuarios']['$inferSelect']
let sessao: Usuario
// A aba do extrato só categoriza quem passa por podeCategorizarDespesaBanco (lista do auth).
let podeCategorizar = false
const mocks = [
  mock.module('@/lib/auth', { namedExports: { getUsuarioLogado: async () => sessao, podeCategorizarDespesaBanco: () => podeCategorizar } }),
  mock.module('next/headers', { namedExports: { cookies: async () => ({ get: () => undefined }) } }),
  mock.module('next/cache', { namedExports: { revalidatePath: () => {} } }),
]

type Db = typeof import('@/lib/db')
let db: Db['db']
let execRows: Db['execRows']
let despesasActions: typeof import('@/app/(dashboard)/despesas/actions')
let caixaActions: typeof import('@/app/(dashboard)/caixa/actions')
let admin: typeof import('@/lib/categorias-admin')

const CNPJS = ['83400000020001', '83400000020002']
const grupos: Base[] = []
let socioDoB: Usuario
const NAO_ENCONTRADA = { ok: false, erro: 'Categoria não encontrada' }

async function socioDe(base: Base): Promise<Usuario> {
  const { usuarios } = await import('@/lib/db/schema')
  const { eq } = await import('drizzle-orm')
  const id = await semearUsuario(db, base, { papel: 'admin_socio', comGrupo: true, comConta: true })
  const [u] = await db.select().from(usuarios).where(eq(usuarios.id, id))
  return u
}

before(async () => {
  ;({ db, execRows } = await import('@/lib/db'))
  despesasActions = await import('@/app/(dashboard)/despesas/actions')
  caixaActions = await import('@/app/(dashboard)/caixa/actions')
  admin = await import('@/lib/categorias-admin')
  for (const [nome, cnpj] of [['GravaA', CNPJS[0]], ['GravaB', CNPJS[1]]]) {
    grupos.push(await semearContaBase(db, { prefixo: 'CAT834G', nome, cnpj }))
  }
  socioDoB = await socioDe(grupos[1])
})

after(async () => {
  const ids = sql.join(grupos.map(g => sql`${g.grupoId}`), sql`, `)
  await db.execute(sql`delete from despesas_open_finance where grupo_id in (${ids})`)
  await db.execute(sql`delete from despesas where grupo_id in (${ids})`)
  await db.execute(sql`delete from lancamentos_caixa where loja_id in (select id from lojas where grupo_id in (${ids}))`)
  await db.execute(sql`delete from usuarios where email like '%-cat834g-%@teste.invalid'`)
  await db.execute(sql`delete from lojas where grupo_id in (${ids})`)
  await db.execute(sql`delete from grupos where id in (${ids})`)
  await db.execute(sql`delete from contas where id in (${sql.join(grupos.map(g => sql`${g.contaId}`), sql`, `)})`)
  for (const m of mocks) m.restore()
  await (globalThis as { __pgPool?: { end(): Promise<void> } }).__pgPool?.end()
})

const despesaCom = (categoria: string) => ({
  lojaId: null, categoria, valor: '10.00', data: '2026-09-10', formaPagamento: 'Pix', banco: 'Banco',
})

const categoriasGravadas = async (grupoId: string) =>
  (await execRows(sql`select categoria from despesas where grupo_id = ${grupoId} order by categoria`)).map(r => r.categoria)

test('despesa: o sócio do B não grava com a categoria do A; com a do B grava (#834)', async () => {
  const [a, b] = grupos
  await admin.criarCategoriaDespesa(db, a.grupoId, { nome: 'CAT834G SoDoA', contaComoDespesa: true })
  await admin.criarCategoriaDespesa(db, b.grupoId, { nome: 'CAT834G DoB', contaComoDespesa: true })
  sessao = socioDoB

  assert.deepEqual(await despesasActions.criarDespesaAction(despesaCom('CAT834G SoDoA')), NAO_ENCONTRADA)
  assert.deepEqual(await despesasActions.criarDespesaAction(despesaCom('CAT834G DoB')), { ok: true, dados: undefined })
  assert.deepEqual(await categoriasGravadas(b.grupoId), ['CAT834G DoB'])
})

test('editar despesa: mantém a categoria antiga fora do catálogo; trocar para a do A recusa (#834)', async () => {
  const [a, b] = grupos
  sessao = socioDoB
  const legada = { id: await semearDespesa(db, { grupoId: b.grupoId, usuarioId: sessao.id, categoria: 'CAT834G Legada', valor: '5.00', data: '2026-09-11' }) }
  await admin.criarCategoriaDespesa(db, a.grupoId, { nome: 'CAT834G OutraDoA', contaComoDespesa: true })

  assert.deepEqual(await despesasActions.editarDespesaAction(legada.id as string, { ...despesaCom('CAT834G Legada'), valor: '6.00' }),
    { ok: true, dados: undefined })
  assert.deepEqual(await despesasActions.editarDespesaAction(legada.id as string, despesaCom('CAT834G OutraDoA')), NAO_ENCONTRADA)
  const [depois] = await execRows(sql`select categoria, valor from despesas where id = ${legada.id}`)
  assert.deepEqual([depois.categoria, depois.valor], ['CAT834G Legada', '6.00'])
})

test('caixa: o lançamento na loja do B não usa a categoria do A (#834)', async () => {
  const [a, b] = grupos
  await admin.criarCategoriaCaixa(db, a.grupoId, { nome: 'CAT834G CaixaDoA', tipo: 'entrada' })
  await admin.criarCategoriaCaixa(db, b.grupoId, { nome: 'CAT834G CaixaDoB', tipo: 'entrada' })
  sessao = socioDoB
  const lancamento = (categoria: string) => ({ lojaId: b.lojaId, tipo: 'entrada' as const, categoria, valor: '20.00', data: '2026-09-12' })

  assert.deepEqual(await caixaActions.criarLancamentoAction(lancamento('CAT834G CaixaDoA')), NAO_ENCONTRADA)
  assert.deepEqual(await caixaActions.criarLancamentoAction(lancamento('CAT834G CaixaDoB')), { ok: true, dados: undefined })
  const gravados = await execRows(sql`select categoria from lancamentos_caixa where loja_id = ${b.lojaId}`)
  assert.deepEqual(gravados.map(r => r.categoria), ['CAT834G CaixaDoB'])
})

test('categoria que exige beneficiário, escrita com outra grafia e sem beneficiário: recusa legível (#834)', async () => {
  const [, b] = grupos
  await admin.criarCategoriaDespesa(db, b.grupoId, { nome: 'CAT834G Retirada', contaComoDespesa: true })
  await db.execute(sql`update categorias_despesa set exige_beneficiario = true where grupo_id = ${b.grupoId} and nome = 'CAT834G Retirada'`)
  sessao = socioDoB

  assert.deepEqual(await despesasActions.criarDespesaAction(despesaCom('cat834g retirada')),
    { ok: false, erro: 'A categoria "cat834g retirada" exige informar a quem se destinou' })
  assert.deepEqual(await despesasActions.criarDespesaAction({ ...despesaCom('CAT834G Retirada'), beneficiario: 'Ninguém' }),
    { ok: false, erro: 'Beneficiário não encontrado no grupo ativo' })
})

async function saidaDoExtrato(grupoId: string, lancada?: { categoria: string; usuarioId: string }) {
  const despesaId = lancada
    ? await semearDespesa(db, { grupoId, usuarioId: lancada.usuarioId, categoria: lancada.categoria, valor: '30.00', data: '2026-09-13' })
    : null
  return { id: await semearSaidaDoExtrato(db, { grupoId, categoria: lancada?.categoria ?? null, despesaId }), despesaId }
}

test('extrato: o sócio do B não lança a saída com a categoria do A; a saída segue pendente (#834)', async () => {
  const [a, b] = grupos
  await admin.criarCategoriaDespesa(db, a.grupoId, { nome: 'CAT834G ExtratoDoA', contaComoDespesa: true })
  sessao = socioDoB
  podeCategorizar = true
  const saida = await saidaDoExtrato(b.grupoId)

  assert.deepEqual(await despesasActions.lancarDespesaOpenFinanceAction(saida.id, 'CAT834G ExtratoDoA', null), NAO_ENCONTRADA)
  const [depois] = await execRows(sql`select despesa_id from despesas_open_finance where id = ${saida.id}`)
  assert.equal(depois.despesa_id, null)
})

test('guarda: o sócio do B lança a saída do B com a categoria do B (#132)', async () => {
  const [, b] = grupos
  await admin.criarCategoriaDespesa(db, b.grupoId, { nome: 'CAT834G LancaDoB', contaComoDespesa: true })
  sessao = socioDoB
  podeCategorizar = true
  const saida = await saidaDoExtrato(b.grupoId)

  assert.deepEqual(await despesasActions.lancarDespesaOpenFinanceAction(saida.id, 'CAT834G LancaDoB', null), { ok: true, dados: undefined })
  const [depois] = await execRows(sql`select o.categoria, o.lancado_por_id, d.grupo_id from despesas_open_finance o
    join despesas d on d.id = o.despesa_id where o.id = ${saida.id}`)
  assert.deepEqual(depois, { categoria: 'CAT834G LancaDoB', lancado_por_id: socioDoB.id, grupo_id: b.grupoId })
  podeCategorizar = false
})

test('extrato: editar a categorização mantendo a categoria antiga fora do catálogo grava; trocar para a do A recusa (#834)', async () => {
  const [a, b] = grupos
  await admin.criarCategoriaDespesa(db, a.grupoId, { nome: 'CAT834G OutraExtratoDoA', contaComoDespesa: true })
  sessao = socioDoB
  podeCategorizar = true
  const saida = await saidaDoExtrato(b.grupoId, { categoria: 'CAT834G LegadaExtrato', usuarioId: socioDoB.id })

  assert.deepEqual(await despesasActions.editarCategorizacaoOpenFinanceAction(saida.id, 'CAT834G LegadaExtrato', b.lojaId),
    { ok: true, dados: undefined })
  assert.deepEqual(await despesasActions.editarCategorizacaoOpenFinanceAction(saida.id, 'CAT834G OutraExtratoDoA', null), NAO_ENCONTRADA)
  const [depois] = await execRows(sql`select categoria, loja_id from despesas where id = ${saida.despesaId}`)
  assert.deepEqual([depois.categoria, depois.loja_id], ['CAT834G LegadaExtrato', b.lojaId])
})

// Saída do banco do B que aponta para uma despesa do A (dado forjado ou SQL à mão): editar e cancelar a
// categorização pelo B não mexem na despesa do A, e a saída fica como estava (#132).
test('extrato: editar e cancelar a categorização pelo B não alteram nem apagam a despesa do A', async () => {
  const [a, b] = grupos
  await admin.criarCategoriaDespesa(db, b.grupoId, { nome: 'CAT834G D132', contaComoDespesa: true })
  await admin.criarCategoriaDespesa(db, b.grupoId, { nome: 'CAT834G D132 Outra', contaComoDespesa: true })
  const despesaA = { id: await semearDespesa(db, { grupoId: a.grupoId, usuarioId: socioDoB.id, categoria: 'CAT834G DoA132', valor: '30.00', data: '2026-09-13' }) }
  const saidaB = { id: await semearSaidaDoExtrato(db, { grupoId: b.grupoId, categoria: 'CAT834G D132', despesaId: despesaA.id }) }
  const despesaDoA = async () => (await execRows(sql`select categoria from despesas where id = ${despesaA.id}`)).map(r => r.categoria)
  const saidaDoB = async () => (await execRows(sql`select categoria, despesa_id from despesas_open_finance where id = ${saidaB.id}`))[0]
  sessao = socioDoB
  podeCategorizar = true

  // Outra categoria e loja: se a recusa saísse fora da transação, a saída do B mudaria.
  await assert.rejects(despesasActions.editarCategorizacaoOpenFinanceAction(saidaB.id as string, 'CAT834G D132 Outra', b.lojaId), /Saída não encontrada/)
  assert.deepEqual(await saidaDoB(), { categoria: 'CAT834G D132', despesa_id: despesaA.id })
  assert.deepEqual(await despesaDoA(), ['CAT834G DoA132'])
  await assert.rejects(despesasActions.cancelarCategorizacaoOpenFinanceAction(saidaB.id as string), /Saída não encontrada/)
  assert.deepEqual(await despesaDoA(), ['CAT834G DoA132'])
  assert.deepEqual(await saidaDoB(), { categoria: 'CAT834G D132', despesa_id: despesaA.id })
  podeCategorizar = false
})
