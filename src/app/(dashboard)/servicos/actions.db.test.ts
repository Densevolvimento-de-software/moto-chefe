// Teste de banco: o catálogo de Serviços é do admin_geral. Chamada direta da action por admin_socio,
// aux_adm, vendedor e mecânico é recusada e o catálogo fica igual; admin_geral grava. Catálogo sem
// Conta: os estados são lidos pelo prefixo SRV228 que este teste cria, nunca pelo total da tabela.
import { after, before, mock, test } from 'node:test'
import assert from 'node:assert/strict'
import { like, sql } from 'drizzle-orm'
import { semearContaBase, semearUsuario } from '@/test/semear-conta'

const url = process.env.TEST_DATABASE_URL
if (!url) throw new Error('TEST_DATABASE_URL não definida — este teste só roda num Postgres descartável')
if (!['localhost', '127.0.0.1'].includes(new URL(url).hostname)) {
  throw new Error('TEST_DATABASE_URL precisa ser loopback (Postgres descartável)')
}
process.env.DATABASE_URL = url

const P = 'SRV228'
let sessao: Record<string, unknown> = {}
const mocks = [
  mock.module('@/lib/auth', { namedExports: {
    getUsuarioLogado: async () => sessao,
    isAdmin: (papel: string) => papel === 'admin_geral',
  } }),
  mock.module('next/cache', { namedExports: { revalidatePath: () => {} } }),
]

type Db = typeof import('@/lib/db')
type Acoes = typeof import('./actions')
type Servico = typeof import('@/lib/db/schema')['servicosCatalogo']
let db: Db['db']
let acoes: Acoes
let servicosCatalogo: Servico
let seedId = ''
let semente: { contaId: string; grupoId: string } | null = null
const papeis = {
  geral: 'admin_geral', socio: 'admin_socio', aux: 'aux_adm', vendedor: 'vendedor', mecanico: 'mecanico',
} as const

const estado = async () => (await db.select({ nome: servicosCatalogo.nome, valor: servicosCatalogo.valor, ativo: servicosCatalogo.ativo })
  .from(servicosCatalogo).where(like(servicosCatalogo.nome, `${P}%`)).orderBy(servicosCatalogo.nome))

const pedidoFalso = { nome: `${P}-forjado`, tempoPrevistoMinutos: null, valor: 1 }

before(async () => {
  ;({ db } = await import('@/lib/db'))
  ;({ servicosCatalogo } = await import('@/lib/db/schema'))
  acoes = await import('./actions')
  const a = await semearContaBase(db, { prefixo: P, nome: 'A', cnpj: '00000000022801' })
  semente = { contaId: a.contaId, grupoId: a.grupoId }
  sessao = { id: await semearUsuario(db, a, { papel: 'admin_geral', rotulo: 'geral', semLoja: true }), papel: papeis.geral }
  const [seed] = await db.insert(servicosCatalogo).values({ nome: `${P}-seed`, valor: '50.00' }).returning({ id: servicosCatalogo.id })
  seedId = seed.id
})

after(async () => {
  try {
    await db.execute(sql`delete from servicos_catalogo where nome like ${`${P}%`}`)
    await db.execute(sql`delete from usuarios where email like '%-srv228-%'`)
    await db.execute(sql`delete from lojas where grupo_id = ${semente?.grupoId ?? null}::uuid`)
    await db.execute(sql`delete from grupos where id = ${semente?.grupoId ?? null}::uuid`)
    await db.execute(sql`delete from contas where id = ${semente?.contaId ?? null}::uuid`)
  } finally {
    for (const m of mocks) m.restore()
    await (globalThis as { __pgPool?: { end(): Promise<void> } }).__pgPool?.end()
  }
})

test('admin_geral cria, edita, inativa e reativa: cada gravação aparece no catálogo', async () => {
  sessao = { papel: papeis.geral }
  const criado = await acoes.criarServicoAction({ nome: `${P}-geral`, valor: 80 })
  await acoes.atualizarServicoAction(criado.id, { nome: `${P}-geral-novo`, valor: 90 })
  await acoes.inativarServicoAction(criado.id)
  assert.deepEqual((await estado()).find(s => s.nome === `${P}-geral-novo`), { nome: `${P}-geral-novo`, valor: '90.00', ativo: false })
  await acoes.reativarServicoAction(criado.id)
  assert.equal((await estado()).find(s => s.nome === `${P}-geral-novo`)?.ativo, true)
})

for (const papel of ['socio', 'aux'] as const) {
  test(`${papel}: criar, editar, inativar e reativar chamados direto são recusados e o catálogo não muda`, async () => {
    sessao = { papel: papeis[papel] }
    const antes = await estado()
    await assert.rejects(acoes.criarServicoAction({ ...pedidoFalso, nome: `${P}-${papel}-criar` }), { message: 'Sem permissão' })
    await assert.rejects(acoes.atualizarServicoAction(seedId, { nome: `${P}-${papel}-editar`, valor: 1 }), { message: 'Sem permissão' })
    await assert.rejects(acoes.inativarServicoAction(seedId), { message: 'Sem permissão' })
    await assert.rejects(acoes.reativarServicoAction(seedId), { message: 'Sem permissão' })
    assert.deepEqual(await estado(), antes)
  })
}

for (const papel of ['vendedor', 'mecanico'] as const) {
  test(`${papel}: criar e editar chamados direto são recusados e o catálogo não muda`, async () => {
    sessao = { papel: papeis[papel] }
    const antes = await estado()
    await assert.rejects(acoes.criarServicoAction({ ...pedidoFalso, nome: `${P}-${papel}-criar` }), { message: 'Sem permissão' })
    await assert.rejects(acoes.atualizarServicoAction(seedId, { nome: `${P}-${papel}-editar`, valor: 1 }), { message: 'Sem permissão' })
    assert.deepEqual(await estado(), antes)
  })
}

test('pedido forjado com campos a mais (ativo, id) por admin_geral: o serviço nasce ativo, com id novo, não o do campo', async () => {
  sessao = { papel: papeis.geral }
  const forjado = { ...pedidoFalso, nome: `${P}-campos`, ativo: false, id: seedId } as typeof pedidoFalso
  const criado = await acoes.criarServicoAction(forjado)
  const [linha] = await db.select({ ativo: servicosCatalogo.ativo, id: servicosCatalogo.id })
    .from(servicosCatalogo).where(like(servicosCatalogo.nome, `${P}-campos`))
  assert.equal(linha.id, criado.id)
  assert.equal(linha.ativo, true)
})

test('aux_adm lista o catálogo (usado pela OS); mecânico não lista', async () => {
  sessao = { papel: papeis.aux }
  assert.ok((await acoes.listarServicosAction()).some(s => s.id === seedId))
  sessao = { papel: papeis.mecanico }
  await assert.rejects(acoes.listarServicosAction(), { message: 'Sem permissão' })
})
