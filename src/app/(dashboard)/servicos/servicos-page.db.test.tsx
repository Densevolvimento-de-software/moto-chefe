import { after, before, mock, test } from 'node:test'
import assert from 'node:assert/strict'
import { semearContaBase } from '@/test/semear-conta'

const url = process.env.TEST_DATABASE_URL
if (!url || !['localhost', '127.0.0.1'].includes(new URL(url).hostname)) throw new Error('Use somente Postgres descartável local')
process.env.DATABASE_URL = url
let sessao: Record<string, unknown> = {}
let grupoAtivo = ''
const mocks = [
  mock.module('@/lib/auth', { namedExports: { getUsuarioLogado: async () => sessao } }),
  mock.module('@/lib/navegacao-servidor', { namedExports: { usuarioPodeAcessar: () => true } }),
  mock.module('next/headers', { namedExports: { cookies: async () => ({ get: () => ({ value: grupoAtivo }) }) } }),
]
let db: typeof import('@/lib/db')['db']
let Page: typeof import('./page')['default']
let a: Awaited<ReturnType<typeof semearContaBase>>, b: Awaited<ReturnType<typeof semearContaBase>>
before(async () => {
  ;({ db } = await import('@/lib/db'))
  const { servicosCatalogo } = await import('@/lib/db/schema')
  ;({ default: Page } = await import('./page'))
  a = await semearContaBase(db, { prefixo: 'SCP273', nome: 'A', cnpj: '00000000227301' })
  b = await semearContaBase(db, { prefixo: 'SCP273', nome: 'B', cnpj: '00000000227302' })
  await db.insert(servicosCatalogo).values([{ contaId: a.contaId, nome: 'Serviço da Conta A', valor: '10' }, { contaId: b.contaId, nome: 'Serviço da Conta B', valor: '20' }])
})
after(async () => {
  for (const m of mocks) m.restore()
  await (globalThis as { __pgPool?: { end(): Promise<void> } }).__pgPool?.end()
})

test('a página envia somente serviços da Conta do grupo ativo', async () => {
  grupoAtivo = a.grupoId
  sessao = { papel: 'admin_socio', contaId: a.contaId, lojaId: a.lojaId, gruposAcesso: [a.grupoId], grupoLiberado: null }
  const tela = await Page()
  assert.deepEqual(tela.props.servicos.map((s: { nome: string }) => s.nome), ['Serviço da Conta A'])
  assert.equal(tela.props.podeGerir, true)
  grupoAtivo = b.grupoId
  sessao = { papel: 'admin_socio', contaId: b.contaId, lojaId: b.lojaId, gruposAcesso: [b.grupoId], grupoLiberado: null }
  const outraTela = await Page()
  assert.deepEqual(outraTela.props.servicos.map((s: { nome: string }) => s.nome), ['Serviço da Conta B'])
})
