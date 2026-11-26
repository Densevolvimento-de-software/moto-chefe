// Serviço na OS por Conta (#273): a OS só aceita serviço ativo da Conta da LOJA da OS. Sessão, cookie e
// revalidatePath são a fronteira simulada; permissão de OS e consultas rodam no banco.
import { after, before, mock, test } from 'node:test'
import assert from 'node:assert/strict'
import { sql } from 'drizzle-orm'
import { sessaoDe } from '@/test/sessao'
import { apagarContasSemeadas, idDoInsert, semearContaBase, semearGrupo, semearUsuario, type Base } from '@/test/semear-conta'

const url = process.env.TEST_DATABASE_URL
if (!url || !['localhost', '127.0.0.1'].includes(new URL(url).hostname)) throw new Error('Use somente Postgres descartável local')
process.env.DATABASE_URL = url

const P = 'SOS273'
let sessao: Record<string, unknown> = {}
const mocks = [
  mock.module('@/lib/auth', { namedExports: { getUsuarioLogado: async () => sessao } }),
  mock.module('next/cache', { namedExports: { revalidatePath: () => {} } }),
  mock.module('next/headers', { namedExports: { cookies: async () => ({ get: () => undefined }) } }),
]
let db: typeof import('@/lib/db')['db']
let adicionar: typeof import('./actions')['adicionarItemOSAction']
let a: Base, b: Base, r: Base
let usuarioDaRede: typeof import('@/lib/grupos-liberados')['usuarioDaRede']
let lojaDoOutroGrupoDeA = ''
let osDeA = '', osDoOutroGrupoDeA = ''
let servicoA = '', servicoB = '', servicoR = '', inativoA = ''
let auxA: Record<string, unknown>, auxB: Record<string, unknown>, auxDoOutroGrupoDeA: Record<string, unknown>
const ID_INEXISTENTE = '00000000-0000-0000-0000-000000000000'
const NAO_ENCONTRADO = { ok: false, erro: 'Serviço não encontrado' }
const item = { tipo: 'servico' as const, descricao: 'Revisão', quantidade: 1, valorUnitario: 100 }

const servicosDaOS = async (osId: string) =>
  ((await db.execute(sql`select servico_id from os_itens where os_id = ${osId} order by id`)) as unknown as { rows: { servico_id: string | null }[] }).rows.map(r => r.servico_id)

before(async () => {
  ;({ db } = await import('@/lib/db'))
  ;({ adicionarItemOSAction: adicionar } = await import('./actions'))
  ;({ usuarioDaRede } = await import('@/lib/grupos-liberados'))
  a = await semearContaBase(db, { prefixo: P, nome: 'A', cnpj: '00000000327301' })
  b = await semearContaBase(db, { prefixo: P, nome: 'B', cnpj: '00000000327302' })
  r = await semearContaBase(db, { prefixo: P, nome: 'R', cnpj: '00000000327304' })
  lojaDoOutroGrupoDeA = (await semearGrupo(db, a.contaId, { prefixo: P, nome: 'Outro grupo', cnpj: '00000000327303' })).lojaId
  const usuarioA = await semearUsuario(db, a, { papel: 'aux_adm' })
  auxA = sessaoDe(a, 'aux_adm', usuarioA)
  auxB = sessaoDe(b, 'aux_adm', await semearUsuario(db, b, { papel: 'aux_adm' }))
  auxDoOutroGrupoDeA = sessaoDe({ lojaId: lojaDoOutroGrupoDeA, contaId: a.contaId }, 'aux_adm', usuarioA)
  osDeA = await idDoInsert(db, sql`insert into ordens_servico (loja_id, aberta_por, descricao) values (${a.lojaId}, ${usuarioA}, 'OS sintética') returning id`)
  osDoOutroGrupoDeA = await idDoInsert(db, sql`insert into ordens_servico (loja_id, aberta_por, descricao) values (${lojaDoOutroGrupoDeA}, ${usuarioA}, 'OS do outro grupo') returning id`)
  servicoA = await idDoInsert(db, sql`insert into servicos_catalogo (conta_id, nome, valor) values (${a.contaId}, ${`${P} A`}, 100) returning id`)
  servicoB = await idDoInsert(db, sql`insert into servicos_catalogo (conta_id, nome, valor) values (${b.contaId}, ${`${P} B`}, 100) returning id`)
  servicoR = await idDoInsert(db, sql`insert into servicos_catalogo (conta_id, nome, valor) values (${r.contaId}, ${`${P} R`}, 100) returning id`)
  inativoA = await idDoInsert(db, sql`insert into servicos_catalogo (conta_id, nome, valor, ativo) values (${a.contaId}, ${`${P} inativo`}, 100, false) returning id`)
  sessao = auxA
})
after(async () => {
  try {
    await apagarContasSemeadas(db, { contaIds: [a, b, r].filter(Boolean).map(c => c.contaId), prefixo: P })
  } finally {
    for (const m of mocks) m.restore()
    await (globalThis as { __pgPool?: { end(): Promise<void> } }).__pgPool?.end()
  }
})

test('OS aceita serviço ativo da Conta da loja e recusa serviço de outra Conta, inativo ou inexistente, sem gravar nada', async () => {
  sessao = auxA
  for (const servicoId of [servicoB, inativoA, ID_INEXISTENTE]) {
    assert.deepEqual(await adicionar(osDeA, { ...item, servicoId }), NAO_ENCONTRADO)
  }
  assert.deepEqual(await servicosDaOS(osDeA), [])
  assert.equal((await adicionar(osDeA, { ...item, servicoId: servicoA })).ok, true)
  assert.deepEqual(await servicosDaOS(osDeA), [servicoA])
})

test('tipo de item forjado não permite vincular serviço de outra Conta', async () => {
  sessao = auxA
  assert.deepEqual(await adicionar(osDeA, { ...item, tipo: 'peca', servicoId: servicoB }), NAO_ENCONTRADO)
})

test('loja de outro grupo da mesma Conta usa o mesmo catálogo', async () => {
  sessao = auxDoOutroGrupoDeA
  assert.equal((await adicionar(osDoOutroGrupoDeA, { ...item, servicoId: servicoA })).ok, true)
  assert.deepEqual(await servicosDaOS(osDoOutroGrupoDeA), [servicoA])
})

test('Conta B não inclui serviço na OS da Conta A: recebe a frase de OS inexistente', async () => {
  sessao = auxB
  assert.deepEqual(await adicionar(osDeA, { ...item, servicoId: servicoB }), { ok: false, erro: 'OS não encontrada' })
  assert.deepEqual(await adicionar(osDeA, { ...item, servicoId: servicoA }), { ok: false, erro: 'OS não encontrada' })
})

test('item sem serviço (mão de obra avulsa) continua sendo aceito', async () => {
  sessao = auxA
  assert.equal((await adicionar(osDeA, { ...item, descricao: 'Avulso' })).ok, true)
  assert.ok((await servicosDaOS(osDeA)).includes(null))
})

test('o catálogo que a OS lista é o da Conta da loja: só serviços ativos dela', async () => {
  const { listarServicosDaLoja } = await import('@/lib/servicos-da-conta')
  assert.deepEqual((await listarServicosDaLoja(lojaDoOutroGrupoDeA)).map(s => s.id), [servicoA])
  assert.deepEqual((await listarServicosDaLoja(b.lojaId)).map(s => s.id), [servicoB])
})

// O admin_rede é da Conta R; o grupo da Conta A foi liberado a ele. A OS é de uma loja do grupo liberado.
const comoAdminRede = (liberados: { grupoId: string; contaId: string }[], grupoAtivo: string) =>
  usuarioDaRede(sessaoDe(r, 'admin_rede', `${P}-rede`, { gruposAcesso: [r.grupoId] }), liberados, grupoAtivo)

test('admin_rede no grupo liberado usa na OS o serviço da Conta dona da loja, e recusa o da própria Conta', async () => {
  sessao = comoAdminRede([{ grupoId: a.grupoId, contaId: a.contaId }], a.grupoId)
  assert.equal((sessao as { grupoLiberado: string | null }).grupoLiberado, a.grupoId)
  assert.deepEqual(await adicionar(osDeA, { ...item, descricao: 'Pela persona', servicoId: servicoR }), NAO_ENCONTRADO)
  assert.deepEqual(await adicionar(osDeA, { ...item, descricao: 'Pela persona', servicoId: servicoB }), NAO_ENCONTRADO)
  assert.equal((await adicionar(osDeA, { ...item, descricao: 'Pela persona', servicoId: servicoA })).ok, true)
  const gravados = (await db.execute(sql`select servico_id from os_itens where os_id = ${osDeA} and descricao = 'Pela persona'`)) as unknown as { rows: { servico_id: string }[] }
  assert.deepEqual(gravados.rows.map(x => x.servico_id), [servicoA])
})

test('admin_rede sem liberação do grupo recebe "OS não encontrada", mesmo com o grupo no cookie', async () => {
  sessao = comoAdminRede([], a.grupoId)
  assert.equal((sessao as { grupoLiberado: string | null }).grupoLiberado, null)
  assert.deepEqual(await adicionar(osDeA, { ...item, descricao: 'Sem liberação', servicoId: servicoA }), { ok: false, erro: 'OS não encontrada' })
  const gravados = (await db.execute(sql`select 1 from os_itens where os_id = ${osDeA} and descricao = 'Sem liberação'`)) as unknown as { rows: unknown[] }
  assert.equal(gravados.rows.length, 0)
})

test('admin_geral com a Conta da sessão diferente da Conta da OS usa o serviço da Conta da loja da OS', async () => {
  sessao = sessaoDe(b, 'admin_geral', `${P}-geral`, { lojaId: null })
  assert.deepEqual(await adicionar(osDeA, { ...item, descricao: 'Pelo geral', servicoId: servicoB }), NAO_ENCONTRADO)
  assert.equal((await adicionar(osDeA, { ...item, descricao: 'Pelo geral', servicoId: servicoA })).ok, true)
  const gravados = (await db.execute(sql`select servico_id from os_itens where os_id = ${osDeA} and descricao = 'Pelo geral'`)) as unknown as { rows: { servico_id: string }[] }
  assert.deepEqual(gravados.rows.map(x => x.servico_id), [servicoA])
})
