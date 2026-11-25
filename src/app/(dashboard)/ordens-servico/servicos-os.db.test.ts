import { after, before, mock, test } from 'node:test'
import assert from 'node:assert/strict'
import { sql } from 'drizzle-orm'
import { idDoInsert, semearContaBase, semearGrupo, semearUsuario } from '@/test/semear-conta'

const url = process.env.TEST_DATABASE_URL
if (!url || !['localhost', '127.0.0.1'].includes(new URL(url).hostname)) throw new Error('Use somente Postgres descartável local')
process.env.DATABASE_URL = url
let sessao: Record<string, unknown> = {}
const mocks = [
  mock.module('@/lib/auth', { namedExports: { getUsuarioLogado: async () => sessao } }),
  mock.module('next/cache', { namedExports: { revalidatePath: () => {} } }),
  mock.module('next/headers', { namedExports: { cookies: async () => ({ get: () => undefined }) } }),
]
let db: typeof import('@/lib/db')['db']
let adicionar: typeof import('./actions')['adicionarItemOSAction']
let osId: string, servicoA: string, servicoB: string, inativo: string
let sessaoA: Record<string, unknown>, sessaoB: Record<string, unknown>, outraLojaA: string
before(async () => {
  ;({ db } = await import('@/lib/db'))
  ;({ adicionarItemOSAction: adicionar } = await import('./actions'))
  const a = await semearContaBase(db, { prefixo: 'SOS273', nome: 'A', cnpj: '00000000327301' })
  const b = await semearContaBase(db, { prefixo: 'SOS273', nome: 'B', cnpj: '00000000327302' })
  const usuarioId = await semearUsuario(db, a, { papel: 'aux_adm' })
  sessao = { id: usuarioId, papel: 'aux_adm', lojaId: a.lojaId, contaId: a.contaId, gruposAcesso: [], grupoLiberado: null }
  sessaoA = sessao
  sessaoB = { id: await semearUsuario(db, b, { papel: 'aux_adm' }), papel: 'aux_adm', lojaId: b.lojaId, contaId: b.contaId, gruposAcesso: [], grupoLiberado: null }
  outraLojaA = (await semearGrupo(db, a.contaId, { prefixo: 'SOS273', nome: 'Outro grupo', cnpj: '00000000327303' })).lojaId
  osId = await idDoInsert(db, sql`insert into ordens_servico (loja_id, aberta_por, descricao) values (${a.lojaId}, ${usuarioId}, 'OS sintética') returning id`)
  servicoA = await idDoInsert(db, sql`insert into servicos_catalogo (conta_id, nome, valor) values (${a.contaId}, 'Serviço A', 100) returning id`)
  servicoB = await idDoInsert(db, sql`insert into servicos_catalogo (conta_id, nome, valor) values (${b.contaId}, 'Serviço B', 100) returning id`)
  inativo = await idDoInsert(db, sql`insert into servicos_catalogo (conta_id, nome, valor, ativo) values (${a.contaId}, 'Serviço inativo', 100, false) returning id`)
})

test('tipo de item forjado não permite vincular serviço de outra Conta', async () => {
  const resultado = await adicionar(osId, { tipo: 'peca', descricao: 'Item', quantidade: 1, valorUnitario: 1, servicoId: servicoB })
  assert.deepEqual(resultado, { ok: false, erro: 'Serviço não encontrado' })
})

test('Conta B não inclui serviço na OS da Conta A', async () => {
  sessao = sessaoB
  const resultado = await adicionar(osId, { tipo: 'servico', descricao: 'Item', quantidade: 1, valorUnitario: 1, servicoId: servicoB })
  assert.deepEqual(resultado, { ok: false, erro: 'OS não encontrada' })
  sessao = sessaoA
})

test('outra loja da mesma Conta enxerga só serviços ativos da sua Conta', async () => {
  const { listarServicosDaLoja } = await import('@/lib/servicos-da-conta')
  const ids = (await listarServicosDaLoja(outraLojaA)).map(s => s.id)
  assert.deepEqual(ids, [servicoA])
})
after(async () => {
  for (const m of mocks) m.restore()
  await (globalThis as { __pgPool?: { end(): Promise<void> } }).__pgPool?.end()
})

test('OS aceita serviço ativo da sua Conta e recusa serviço externo, inativo ou inexistente', async () => {
  const item = { tipo: 'servico' as const, descricao: 'Revisão', quantidade: 1, valorUnitario: 100 }
  for (const servicoId of [servicoB, inativo, '00000000-0000-0000-0000-000000000000']) {
    assert.deepEqual(await adicionar(osId, { ...item, servicoId }), { ok: false, erro: 'Serviço não encontrado' })
  }
  assert.equal((await adicionar(osId, { ...item, servicoId: servicoA })).ok, true)
  const { rows } = await db.execute(sql`select servico_id from os_itens where os_id = ${osId}`) as unknown as { rows: { servico_id: string }[] }
  assert.deepEqual(rows.map(r => r.servico_id), [servicoA])
})
