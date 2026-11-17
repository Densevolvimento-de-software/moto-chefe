// Teste de banco: Postgres descartável. A linha do login da fábrica (#3) não tem loja, Conta,
// cargo, papéis extras, módulos liberados nem grupos: o banco recusa, mesmo fora da tela.
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { sql } from 'drizzle-orm'
import { semearContaBase, type Base } from '@/test/semear-conta'

const url = process.env.TEST_DATABASE_URL
if (!url) throw new Error('TEST_DATABASE_URL não definida — este teste só roda num Postgres descartável')
if (!['localhost', '127.0.0.1'].includes(new URL(url).hostname)) {
  throw new Error('TEST_DATABASE_URL precisa ser loopback (Postgres descartável)')
}
process.env.DATABASE_URL = url

type Db = typeof import('@/lib/db')
let db: Db['db']
let base: Base
let seq = 0

before(async () => {
  ;({ db } = await import('@/lib/db'))
  base = await semearContaBase(db, { prefixo: 'FAB3CHK', nome: 'Rede', cnpj: '00000000000391' })
})
after(async () => { await (globalThis as { __pgPool?: { end(): Promise<void> } }).__pgPool?.end() })

const inserir = (extra: ReturnType<typeof sql>) => db.execute(sql`
  insert into usuarios (id, nome, email, papel, loja_id, conta_id, papeis_extras, modulos_extras, grupos_acesso, grupos_aprovacao)
  select gen_random_uuid(), 'Fábrica', ${`fab3-chk-${seq++}@teste.invalid`}, 'fabrica', v.loja_id, v.conta_id, v.papeis_extras, v.modulos_extras, v.grupos_acesso, v.grupos_aprovacao
  from (${extra}) v`)
/** O Drizzle embrulha o erro do Postgres ("Failed query"); a constraint vem no `cause`. */
const recusadoPelaTrava = (e: unknown) => (e as { cause?: { constraint?: string } }).cause?.constraint === 'usuarios_fabrica_sem_conta'
const limpa = sql`select null::uuid as loja_id, null::uuid as conta_id, '{}'::text[] as papeis_extras, '{}'::text[] as modulos_extras, '{}'::uuid[] as grupos_acesso, '{}'::uuid[] as grupos_aprovacao`

test('login da fábrica sem loja, Conta e extras grava', async () => {
  await inserir(limpa)
})

test('login da fábrica com loja, Conta, papel extra, módulo liberado ou grupo é recusado pelo banco', async () => {
  const casos = {
    loja: sql`select ${base.lojaId}::uuid as loja_id, null::uuid as conta_id, '{}'::text[] as papeis_extras, '{}'::text[] as modulos_extras, '{}'::uuid[] as grupos_acesso, '{}'::uuid[] as grupos_aprovacao`,
    conta: sql`select null::uuid as loja_id, ${base.contaId}::uuid as conta_id, '{}'::text[] as papeis_extras, '{}'::text[] as modulos_extras, '{}'::uuid[] as grupos_acesso, '{}'::uuid[] as grupos_aprovacao`,
    papelExtra: sql`select null::uuid as loja_id, null::uuid as conta_id, '{vendedor}'::text[] as papeis_extras, '{}'::text[] as modulos_extras, '{}'::uuid[] as grupos_acesso, '{}'::uuid[] as grupos_aprovacao`,
    modulo: sql`select null::uuid as loja_id, null::uuid as conta_id, '{}'::text[] as papeis_extras, '{pix}'::text[] as modulos_extras, '{}'::uuid[] as grupos_acesso, '{}'::uuid[] as grupos_aprovacao`,
    grupoAcesso: sql`select null::uuid as loja_id, null::uuid as conta_id, '{}'::text[] as papeis_extras, '{}'::text[] as modulos_extras, array[${base.grupoId}::uuid] as grupos_acesso, '{}'::uuid[] as grupos_aprovacao`,
    grupoAprovacao: sql`select null::uuid as loja_id, null::uuid as conta_id, '{}'::text[] as papeis_extras, '{}'::text[] as modulos_extras, '{}'::uuid[] as grupos_acesso, array[${base.grupoId}::uuid] as grupos_aprovacao`,
  }
  for (const [nome, caso] of Object.entries(casos)) {
    await assert.rejects(inserir(caso), recusadoPelaTrava, nome)
  }
})

test('trocar para fabrica uma linha que tem loja também é recusado', async () => {
  const [u] = (await db.execute(sql`insert into usuarios (id, nome, email, papel, loja_id) values (gen_random_uuid(), 'Vend', ${`fab3-chk-${seq++}@teste.invalid`}, 'vendedor', ${base.lojaId}) returning id`) as unknown as { rows: { id: string }[] }).rows
  await assert.rejects(db.execute(sql`update usuarios set papel = 'fabrica' where id = ${u.id}`), recusadoPelaTrava)
})
