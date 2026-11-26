import { after, before, mock, test } from 'node:test'
import assert from 'node:assert/strict'
import { sql } from 'drizzle-orm'
import { idDoInsert, semearContaBase, semearUsuario } from '@/test/semear-conta'

const url = process.env.TEST_DATABASE_URL
if (!url || !['localhost', '127.0.0.1'].includes(new URL(url).hostname)) throw new Error('Use somente Postgres descartável local')
process.env.DATABASE_URL = url
let sessao: Record<string, unknown> = {}
let leituras = 0
class NaoEncontrada extends Error {}
const mocks = [
  mock.module('@/lib/auth', { namedExports: { getUsuarioLogado: async () => sessao } }),
  mock.module('@/lib/navegacao-servidor', { namedExports: { usuarioPodeAcessar: () => true } }),
  mock.module('@/lib/queries/ordens-servico', { namedExports: { buscarOS: async () => { leituras++; return null }, listarItensOS: async () => { leituras++; return [] } } }),
  mock.module('@/lib/servicos-da-conta', { namedExports: { listarServicosDaLoja: async () => { leituras++; return [] }, servicoUsavelNaLoja: async () => false } }),
  mock.module('next/navigation', { namedExports: { notFound: () => { throw new NaoEncontrada() }, redirect: () => { throw new Error('redirect') } } }),
]
let Page: typeof import('./[id]/page')['default']
let osId: string
before(async () => {
  const { db } = await import('@/lib/db')
  const a = await semearContaBase(db, { prefixo: 'SOP273', nome: 'A', cnpj: '00000000427301' })
  const b = await semearContaBase(db, { prefixo: 'SOP273', nome: 'B', cnpj: '00000000427302' })
  const usuarioA = await semearUsuario(db, a, { papel: 'aux_adm' })
  const usuarioB = await semearUsuario(db, b, { papel: 'aux_adm' })
  sessao = { id: usuarioB, papel: 'aux_adm', lojaId: b.lojaId, contaId: b.contaId, gruposAcesso: [], grupoLiberado: null }
  osId = await idDoInsert(db, sql`insert into ordens_servico (loja_id, aberta_por, descricao) values (${a.lojaId}, ${usuarioA}, 'OS sintética') returning id`)
  ;({ default: Page } = await import('./[id]/page'))
})
after(async () => {
  for (const m of mocks) m.restore()
  await (globalThis as { __pgPool?: { end(): Promise<void> } }).__pgPool?.end()
})

test('página de OS de outra Conta recusa antes de carregar itens e catálogo', async () => {
  await assert.rejects(Page({ params: Promise.resolve({ id: osId }) }), NaoEncontrada)
  assert.equal(leituras, 0)
})
