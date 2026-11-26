// Teste de banco: gestão do catálogo de Serviços por Conta (#273). A Conta vem do grupo ativo de verdade
// (cookie + sessão); só a fronteira de fora é simulada (sessão, cookie, revalidatePath).
// Roda no Postgres descartável do CI. Local: `npm run test:db:local`.
import { after, before, mock, test } from 'node:test'
import assert from 'node:assert/strict'
import { eq } from 'drizzle-orm'
import { apagarContasSemeadas, semearContaBase, type Base } from '@/test/semear-conta'
import { sessaoDe } from '@/test/sessao'

const url = process.env.TEST_DATABASE_URL
if (!url) throw new Error('TEST_DATABASE_URL não definida — este teste só roda num Postgres descartável')
if (!['localhost', '127.0.0.1'].includes(new URL(url).hostname)) {
  throw new Error('TEST_DATABASE_URL precisa ser loopback (Postgres descartável)')
}
process.env.DATABASE_URL = url

const P = 'SVC273'
let sessao: Record<string, unknown> = {}
let grupoNoCookie: string | undefined
const mocks = [
  mock.module('@/lib/auth', { namedExports: { getUsuarioLogado: async () => sessao, isAdmin: (papel: string) => papel === 'admin_geral' } }),
  mock.module('next/headers', { namedExports: { cookies: async () => ({ get: (nome: string) => (nome === 'grupoAtivo' && grupoNoCookie ? { value: grupoNoCookie } : undefined) }) } }),
  mock.module('next/cache', { namedExports: { revalidatePath: () => {} } }),
]

type Db = typeof import('@/lib/db')
let db: Db['db']
let acoes: typeof import('./actions')
let tabela: typeof import('@/lib/db/schema')['servicosCatalogo']
let a: Base, b: Base
let servicoA = '', servicoB = ''
const contasSemeadas = () => [a, b].filter(Boolean).map(c => c.contaId)

const ID_INEXISTENTE = '00000000-0000-0000-0000-000000000000'

const socioDe = (c: Base, gruposAcesso: string[] = [c.grupoId]) => sessaoDe(c, 'admin_socio', `${P}-socio`, { lojaId: null, gruposAcesso })
const doPapel = (c: Base, papel: string) => sessaoDe(c, papel, `${P}-${papel}`)
const entrar = (usuario: Record<string, unknown>, grupo: string) => { sessao = usuario; grupoNoCookie = grupo }

const nomesDaConta = async (contaId: string) =>
  (await db.select({ nome: tabela.nome }).from(tabela).where(eq(tabela.contaId, contaId)).orderBy(tabela.nome)).map(s => s.nome)
const linhaDe = async (id: string) =>
  (await db.select({ contaId: tabela.contaId, nome: tabela.nome, valor: tabela.valor, ativo: tabela.ativo }).from(tabela).where(eq(tabela.id, id)))[0]
const nomesListados = async () => (await acoes.listarServicosAction()).map(s => s.nome).sort()

before(async () => {
  ;({ db } = await import('@/lib/db'))
  ;({ servicosCatalogo: tabela } = await import('@/lib/db/schema'))
  acoes = await import('./actions')
  a = await semearContaBase(db, { prefixo: P, nome: 'A', cnpj: '00000000273001' })
  b = await semearContaBase(db, { prefixo: P, nome: 'B', cnpj: '00000000273003' })
  ;[{ id: servicoA }, { id: servicoB }] = await db.insert(tabela).values([
    { contaId: a.contaId, nome: `${P} serviço de A`, valor: '100' },
    { contaId: b.contaId, nome: `${P} serviço de B`, valor: '200' },
  ]).returning({ id: tabela.id })
})

after(async () => {
  try {
    // Só o que a semente chegou a criar: um before que falhou no meio não esconde o erro dele.
    await apagarContasSemeadas(db, { contaIds: contasSemeadas(), prefixo: P })
  } finally {
    for (const m of mocks) m.restore()
    await (globalThis as { __pgPool?: { end(): Promise<void> } }).__pgPool?.end()
  }
})

test('sócio da Conta B não lista serviço da Conta A', async () => {
  entrar(socioDe(b), b.grupoId)
  assert.deepEqual(await nomesListados(), [`${P} serviço de B`])
})

test('sócio da Conta B não edita, inativa nem reativa serviço da A: mesma frase de id inexistente, e a A fica igual', async () => {
  entrar(socioDe(b), b.grupoId)
  const antes = await linhaDe(servicoA)
  for (const chamar of [
    (id: string) => acoes.atualizarServicoAction(id, { nome: `${P} invadido`, valor: 1 }),
    (id: string) => acoes.inativarServicoAction(id),
    (id: string) => acoes.reativarServicoAction(id),
  ]) {
    await assert.rejects(chamar(servicoA), { message: 'Serviço não encontrado' })
    await assert.rejects(chamar(ID_INEXISTENTE), { message: 'Serviço não encontrado' })
  }
  assert.deepEqual(await linhaDe(servicoA), antes)
})

test('pedido forjado com Conta, estado e id a mais: o serviço nasce na Conta do grupo ativo, ativo, com id novo', async () => {
  entrar(socioDe(b), b.grupoId)
  const forjado = { nome: `${P} forjado`, valor: 5, contaId: a.contaId, ativo: false, id: servicoA } as Parameters<typeof acoes.criarServicoAction>[0]
  const { id } = await acoes.criarServicoAction(forjado)
  assert.notEqual(id, servicoA)
  assert.deepEqual(await linhaDe(id), { contaId: b.contaId, nome: `${P} forjado`, valor: '5.00', ativo: true })
})

test('edição com Conta e estado a mais muda só nome, tempo e valor', async () => {
  entrar(socioDe(b), b.grupoId)
  const { id } = await acoes.criarServicoAction({ nome: `${P} editável`, valor: 7 })
  const forjado = { nome: `${P} editado`, valor: 8, contaId: a.contaId, ativo: false } as Parameters<typeof acoes.atualizarServicoAction>[1]
  await acoes.atualizarServicoAction(id, forjado)
  assert.deepEqual(await linhaDe(id), { contaId: b.contaId, nome: `${P} editado`, valor: '8.00', ativo: true })
})

test('aux_adm, vendedor e mecânico não gravam: as quatro gravações são recusadas e o catálogo fica igual', async () => {
  const antes = [await nomesDaConta(a.contaId), await linhaDe(servicoA)]
  for (const papel of ['aux_adm', 'vendedor', 'mecanico']) {
    entrar(doPapel(a, papel), a.grupoId)
    await assert.rejects(acoes.criarServicoAction({ nome: `${P} ${papel}`, valor: 1 }), { message: 'Sem permissão' }, papel)
    await assert.rejects(acoes.atualizarServicoAction(servicoA, { nome: `${P} ${papel}`, valor: 1 }), { message: 'Sem permissão' }, papel)
    await assert.rejects(acoes.inativarServicoAction(servicoA), { message: 'Sem permissão' }, papel)
    await assert.rejects(acoes.reativarServicoAction(servicoA), { message: 'Sem permissão' }, papel)
  }
  assert.deepEqual([await nomesDaConta(a.contaId), await linhaDe(servicoA)], antes)
})

test('aux_adm lista o catálogo da própria Conta; vendedor e mecânico não listam', async () => {
  entrar(doPapel(a, 'aux_adm'), a.grupoId)
  assert.ok((await nomesListados()).includes(`${P} serviço de A`))
  for (const papel of ['vendedor', 'mecanico']) {
    entrar(doPapel(a, papel), a.grupoId)
    await assert.rejects(acoes.listarServicosAction(), { message: 'Sem permissão' }, papel)
  }
})
