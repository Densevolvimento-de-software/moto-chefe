import { after, before, mock, test } from 'node:test'
import assert from 'node:assert/strict'
import { eq } from 'drizzle-orm'
import { semearContaBase } from '@/test/semear-conta'

const url = process.env.TEST_DATABASE_URL
if (!url || !['localhost', '127.0.0.1'].includes(new URL(url).hostname)) throw new Error('Use somente Postgres descartável local')
process.env.DATABASE_URL = url
let sessao: Record<string, unknown> = {}
let contaAtiva = ''
const mocks = [
  mock.module('@/lib/auth', { namedExports: { getUsuarioLogado: async () => sessao, isAdmin: (p: string) => p === 'admin_geral' } }),
  mock.module('@/lib/grupo', { namedExports: { contaDoGrupoAtivo: async () => contaAtiva } }),
  mock.module('next/cache', { namedExports: { revalidatePath: () => {} } }),
]
let db: typeof import('@/lib/db')['db']
let tabela: typeof import('@/lib/db/schema')['servicosCatalogo']
let actions: typeof import('./actions')
let contaA: string, contaB: string, idA: string
before(async () => {
  ;({ db } = await import('@/lib/db'))
  ;({ servicosCatalogo: tabela } = await import('@/lib/db/schema'))
  actions = await import('./actions')
  contaA = (await semearContaBase(db, { prefixo: 'SC273', nome: 'A', cnpj: '00000000027301' })).contaId
  contaB = (await semearContaBase(db, { prefixo: 'SC273', nome: 'B', cnpj: '00000000027302' })).contaId
  ;[{ id: idA }] = await db.insert(tabela).values({ contaId: contaA, nome: 'SC273 original', valor: '100' }).returning({ id: tabela.id })
})
after(async () => {
  for (const m of mocks) m.restore()
  await (globalThis as { __pgPool?: { end(): Promise<void> } }).__pgPool?.end()
})

test('sócio da Conta B não lista nem altera serviço da Conta A', async () => {
  contaAtiva = contaB
  sessao = { papel: 'admin_socio', papelReal: 'admin_socio', contaId: contaB, grupoLiberado: null }
  assert.ok(!(await actions.listarServicosAction()).some(s => s.id === idA))
  await assert.rejects(actions.atualizarServicoAction(idA, { nome: 'Alterado', valor: 1 }), /Serviço não encontrado/)
  assert.equal((await db.select().from(tabela).where(eq(tabela.id, idA)))[0].nome, 'SC273 original')
})

test('sócio cadastra e inativa serviço próprio; aux_adm não gerencia', async () => {
  contaAtiva = contaA
  sessao = { papel: 'admin_socio', papelReal: 'admin_socio', contaId: contaA, grupoLiberado: null }
  const criado = await actions.criarServicoAction({ nome: 'SC273 próprio', valor: 80 })
  await actions.inativarServicoAction(criado.id)
  assert.equal((await db.select().from(tabela).where(eq(tabela.id, criado.id)))[0].ativo, false)
  sessao = { papel: 'aux_adm', papelReal: 'aux_adm', contaId: contaA, grupoLiberado: null }
  await assert.rejects(actions.reativarServicoAction(criado.id), /Sem permissão/)
})

test('admin_rede em grupo liberado de outra Conta não gerencia serviços dessa Conta', async () => {
  contaAtiva = contaA
  sessao = { papel: 'admin_socio', papelReal: 'admin_rede', contaId: contaA, grupoLiberado: 'grupo-externo', origem: { contaId: contaB } }
  await assert.rejects(actions.inativarServicoAction(idA), /Sem permissão/)
  assert.equal((await db.select().from(tabela).where(eq(tabela.id, idA)))[0].ativo, true)
})

test('admin geral e admin de rede gerenciam na Conta selecionada', async () => {
  contaAtiva = contaB
  for (const papelReal of ['admin_geral', 'admin_rede']) {
    sessao = { papel: papelReal === 'admin_rede' ? 'admin_socio' : papelReal, papelReal, contaId: contaB, grupoLiberado: null }
    const criado = await actions.criarServicoAction({ nome: `SC273 ${papelReal}`, valor: 10, contaId: contaA } as Parameters<typeof actions.criarServicoAction>[0])
    await actions.atualizarServicoAction(criado.id, { nome: `SC273 editado ${papelReal}`, valor: 20 })
    await actions.inativarServicoAction(criado.id)
    await actions.reativarServicoAction(criado.id)
    const [linha] = await db.select().from(tabela).where(eq(tabela.id, criado.id))
    assert.equal(linha.contaId, contaB)
    assert.equal(linha.ativo, true)
    assert.equal(linha.valor, '20.00')
  }
})

test('inativar e reativar serviço de outra Conta têm a mesma recusa de inexistente', async () => {
  contaAtiva = contaB
  sessao = { papel: 'admin_socio', papelReal: 'admin_socio', contaId: contaB, grupoLiberado: null }
  for (const acao of [actions.inativarServicoAction, actions.reativarServicoAction]) {
    for (const id of [idA, '00000000-0000-0000-0000-000000000000']) {
      await assert.rejects(acao(id), { message: 'Serviço não encontrado' })
    }
  }
  assert.equal((await db.select().from(tabela).where(eq(tabela.id, idA)))[0].ativo, true)
})
