// Teste de banco: gestão do catálogo de Serviços por Conta (#273). A Conta vem do grupo ativo de verdade
// (cookie + sessão); só a fronteira de fora é simulada (sessão, cookie, revalidatePath).
// Roda no Postgres descartável do CI. Local: `npm run test:db:local`.
import { after, before, mock, test } from 'node:test'
import assert from 'node:assert/strict'
import { eq } from 'drizzle-orm'
import { apagarContasSemeadas, semearContaBase, semearGrupo, type Base } from '@/test/semear-conta'
import { sessaoDe } from '@/test/sessao'
import type { ResultadoAction } from '@/lib/resultado-action'

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
let usuarioDaRede: typeof import('@/lib/grupos-liberados')['usuarioDaRede']
let a: Base, b: Base, r: Base
let grupoA2 = ''
let servicoA = '', servicoB = ''
const contasSemeadas = () => [a, b, r].filter(Boolean).map(c => c.contaId)

const SEM_PERMISSAO = { ok: false, erro: 'Sem permissão' }
const NAO_ENCONTRADO = { ok: false, erro: 'Serviço não encontrado' }
const ID_INEXISTENTE = '00000000-0000-0000-0000-000000000000'

const socioDe = (c: Base, gruposAcesso: string[] = [c.grupoId]) => sessaoDe(c, 'admin_socio', `${P}-socio`, { lojaId: null, gruposAcesso })
const doPapel = (c: Base, papel: string) => sessaoDe(c, papel, `${P}-${papel}`)
const entrar = (usuario: Record<string, unknown>, grupo: string) => { sessao = usuario; grupoNoCookie = grupo }
// O admin_rede vira a persona do grupo liberado só se o grupo está entre os liberados a ele (usuarioDaRede real).
const entrarComoAdminRede = (liberados: { grupoId: string; contaId: string }[], grupoAtivo: string) => {
  entrar(usuarioDaRede(sessaoDe(r, 'admin_rede', `${P}-rede`, { gruposAcesso: [r.grupoId] }), liberados, grupoAtivo), grupoAtivo)
}

const dados = <T>(resultado: ResultadoAction<T>): T => {
  assert.equal(resultado.ok, true, JSON.stringify(resultado))
  return (resultado as { ok: true; dados: T }).dados
}
const nomesDaConta = async (contaId: string) =>
  (await db.select({ nome: tabela.nome }).from(tabela).where(eq(tabela.contaId, contaId)).orderBy(tabela.nome)).map(s => s.nome)
const linhaDe = async (id: string) =>
  (await db.select({ contaId: tabela.contaId, nome: tabela.nome, valor: tabela.valor, ativo: tabela.ativo }).from(tabela).where(eq(tabela.id, id)))[0]
const nomesListados = async () => dados(await acoes.listarServicosAction()).map(s => s.nome).sort()

before(async () => {
  ;({ db } = await import('@/lib/db'))
  ;({ servicosCatalogo: tabela } = await import('@/lib/db/schema'))
  ;({ usuarioDaRede } = await import('@/lib/grupos-liberados'))
  acoes = await import('./actions')
  a = await semearContaBase(db, { prefixo: P, nome: 'A', cnpj: '00000000273001' })
  grupoA2 = (await semearGrupo(db, a.contaId, { prefixo: P, nome: 'A2', cnpj: '00000000273002' })).grupoId
  b = await semearContaBase(db, { prefixo: P, nome: 'B', cnpj: '00000000273003' })
  r = await semearContaBase(db, { prefixo: P, nome: 'R', cnpj: '00000000273004' })
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
    assert.deepEqual(await chamar(servicoA), NAO_ENCONTRADO)
    assert.deepEqual(await chamar(ID_INEXISTENTE), NAO_ENCONTRADO)
  }
  assert.deepEqual(await linhaDe(servicoA), antes)
})

test('pedido forjado com Conta, estado e id a mais: o serviço nasce na Conta do grupo ativo, ativo, com id novo', async () => {
  entrar(socioDe(b), b.grupoId)
  const forjado = { nome: `${P} forjado`, valor: 5, contaId: a.contaId, ativo: false, id: servicoA } as Parameters<typeof acoes.criarServicoAction>[0]
  const { id } = dados(await acoes.criarServicoAction(forjado))
  assert.notEqual(id, servicoA)
  assert.deepEqual(await linhaDe(id), { contaId: b.contaId, nome: `${P} forjado`, valor: '5.00', ativo: true })
})

test('edição com Conta e estado a mais muda só nome, tempo e valor', async () => {
  entrar(socioDe(b), b.grupoId)
  const { id } = dados(await acoes.criarServicoAction({ nome: `${P} editável`, valor: 7 }))
  const forjado = { nome: `${P} editado`, valor: 8, contaId: a.contaId, ativo: false } as Parameters<typeof acoes.atualizarServicoAction>[1]
  dados(await acoes.atualizarServicoAction(id, forjado))
  assert.deepEqual(await linhaDe(id), { contaId: b.contaId, nome: `${P} editado`, valor: '8.00', ativo: true })
})

test('sócio com dois grupos da mesma Conta vê o mesmo catálogo nos dois', async () => {
  const sessaoDoSocio = socioDe(a, [a.grupoId, grupoA2])
  entrar(sessaoDoSocio, a.grupoId)
  const noPrimeiro = await nomesListados()
  entrar(sessaoDoSocio, grupoA2)
  assert.deepEqual(await nomesListados(), noPrimeiro)
  assert.ok(noPrimeiro.includes(`${P} serviço de A`))
})

test('aux_adm, vendedor e mecânico não gravam: as quatro gravações são recusadas e o catálogo fica igual', async () => {
  const antes = [await nomesDaConta(a.contaId), await linhaDe(servicoA)]
  for (const papel of ['aux_adm', 'vendedor', 'mecanico']) {
    entrar(doPapel(a, papel), a.grupoId)
    assert.deepEqual(await acoes.criarServicoAction({ nome: `${P} ${papel}`, valor: 1 }), SEM_PERMISSAO, papel)
    assert.deepEqual(await acoes.atualizarServicoAction(servicoA, { nome: `${P} ${papel}`, valor: 1 }), SEM_PERMISSAO, papel)
    assert.deepEqual(await acoes.inativarServicoAction(servicoA), SEM_PERMISSAO, papel)
    assert.deepEqual(await acoes.reativarServicoAction(servicoA), SEM_PERMISSAO, papel)
  }
  assert.deepEqual([await nomesDaConta(a.contaId), await linhaDe(servicoA)], antes)
})

test('aux_adm lista o catálogo da própria Conta; vendedor e mecânico não listam', async () => {
  entrar(doPapel(a, 'aux_adm'), a.grupoId)
  assert.ok((await nomesListados()).includes(`${P} serviço de A`))
  for (const papel of ['vendedor', 'mecanico']) {
    entrar(doPapel(a, papel), a.grupoId)
    assert.deepEqual(await acoes.listarServicosAction(), SEM_PERMISSAO, papel)
  }
})

test('admin_geral gere a Conta do grupo ativo no cookie, não todas', async () => {
  const geral = sessaoDe(a, 'admin_geral', `${P}-geral`, { lojaId: null, contaId: null })
  entrar(geral, a.grupoId)
  const { id } = dados(await acoes.criarServicoAction({ nome: `${P} do geral`, valor: 3 }))
  assert.equal((await linhaDe(id)).contaId, a.contaId)
  entrar(geral, b.grupoId)
  assert.deepEqual(await acoes.atualizarServicoAction(id, { nome: `${P} do geral na B`, valor: 3 }), NAO_ENCONTRADO)
})

test('valor que não é número finito é recusado na criação e na edição, e nada é gravado', async () => {
  entrar(socioDe(b), b.grupoId)
  const antes = await nomesDaConta(b.contaId)
  for (const valor of [NaN, Infinity]) {
    assert.deepEqual(await acoes.criarServicoAction({ nome: `${P} inválido`, valor }), { ok: false, erro: 'Valor inválido' })
    assert.deepEqual(await acoes.atualizarServicoAction(servicoB, { nome: `${P} inválido`, valor }), { ok: false, erro: 'Valor inválido' })
  }
  assert.deepEqual(await nomesDaConta(b.contaId), antes)
  assert.equal((await linhaDe(servicoB)).valor, '200.00')
})

test('nome vazio e valor negativo são recusados com a frase', async () => {
  entrar(socioDe(b), b.grupoId)
  assert.deepEqual(await acoes.criarServicoAction({ nome: '  ', valor: 1 }), { ok: false, erro: 'Nome é obrigatório' })
  assert.deepEqual(await acoes.criarServicoAction({ nome: `${P} negativo`, valor: -1 }), { ok: false, erro: 'Valor não pode ser negativo' })
})

test('admin_rede na própria Conta gerencia: cria, edita, inativa e reativa', async () => {
  entrarComoAdminRede([{ grupoId: b.grupoId, contaId: b.contaId }], r.grupoId)
  const { id } = dados(await acoes.criarServicoAction({ nome: `${P} da rede`, valor: 10 }))
  dados(await acoes.atualizarServicoAction(id, { nome: `${P} da rede editado`, valor: 20 }))
  dados(await acoes.inativarServicoAction(id))
  assert.equal((await linhaDe(id)).ativo, false)
  dados(await acoes.reativarServicoAction(id))
  assert.deepEqual(await linhaDe(id), { contaId: r.contaId, nome: `${P} da rede editado`, valor: '20.00', ativo: true })
})

test('admin_rede no grupo liberado de outra Conta vê o catálogo dela, mas não cria, edita, inativa nem reativa', async () => {
  entrarComoAdminRede([{ grupoId: b.grupoId, contaId: b.contaId }], b.grupoId)
  assert.equal((sessao as { grupoLiberado: string | null }).grupoLiberado, b.grupoId)
  assert.ok((await nomesListados()).includes(`${P} serviço de B`))
  const antes = [await nomesDaConta(b.contaId), await linhaDe(servicoB)]
  assert.deepEqual(await acoes.criarServicoAction({ nome: `${P} da rede em B`, valor: 1 }), SEM_PERMISSAO)
  assert.deepEqual(await acoes.atualizarServicoAction(servicoB, { nome: `${P} da rede em B`, valor: 1 }), SEM_PERMISSAO)
  assert.deepEqual(await acoes.inativarServicoAction(servicoB), SEM_PERMISSAO)
  assert.deepEqual(await acoes.reativarServicoAction(servicoB), SEM_PERMISSAO)
  assert.deepEqual([await nomesDaConta(b.contaId), await linhaDe(servicoB)], antes)
})

test('admin_rede sem liberação, com o grupo de outra Conta no cookie: cai na própria Conta, não vê nem grava na outra', async () => {
  entrarComoAdminRede([], b.grupoId)
  assert.equal((sessao as { grupoLiberado: string | null }).grupoLiberado, null)
  assert.ok(!(await nomesListados()).includes(`${P} serviço de B`))
  assert.deepEqual(await acoes.atualizarServicoAction(servicoB, { nome: `${P} sem liberação`, valor: 1 }), NAO_ENCONTRADO)
  const { id } = dados(await acoes.criarServicoAction({ nome: `${P} sem liberação`, valor: 1 }))
  assert.equal((await linhaDe(id)).contaId, r.contaId)
})
