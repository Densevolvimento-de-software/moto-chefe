import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { sql } from 'drizzle-orm'

const url = process.env.TEST_DATABASE_URL
if (!url || !['localhost', '127.0.0.1'].includes(new URL(url).hostname)) throw new Error('Use somente Postgres descartável local')
process.env.DATABASE_URL = url
let db: typeof import('@/lib/db')['db']
before(async () => { ({ db } = await import('@/lib/db')) })
after(async () => { await (globalThis as { __pgPool?: { end(): Promise<void> } }).__pgPool?.end() })
class Desfazer extends Error {}

test('conclusão mantém serviços por Conta e remove somente registros globais sem referência', async () => {
  await assert.rejects(db.transaction(async tx => {
    await tx.execute(sql.raw(`create temporary table servicos_catalogo (id uuid primary key, conta_id uuid, nome text not null, migracao_273_origem boolean not null default false);
      create temporary table os_itens (servico_id uuid references servicos_catalogo);
      insert into servicos_catalogo values ('00000000-0000-0000-0000-000000000011', null, 'global', true), ('00000000-0000-0000-0000-000000000012', '00000000-0000-0000-0000-000000000001', 'próprio', false);
      insert into os_itens values ('00000000-0000-0000-0000-000000000012');`))
    await tx.execute(sql.raw(readFileSync('src/lib/db/migrations/0210_servicos_concluir_contas.sql', 'utf8')))
    const { rows } = await tx.execute(sql`select nome from servicos_catalogo`) as unknown as { rows: { nome: string }[] }
    assert.deepEqual(rows, [{ nome: 'próprio' }])
    await assert.rejects(tx.transaction(t => t.execute(sql`insert into servicos_catalogo values (gen_random_uuid(), null, 'sem Conta')`)))
    throw new Desfazer()
  }), Desfazer)
})

test('conclusão recusa remover serviço global ainda vinculado a uma OS', async () => {
  await assert.rejects(db.transaction(async tx => {
    await tx.execute(sql.raw(`create temporary table servicos_catalogo (id uuid primary key, conta_id uuid, nome text not null, migracao_273_origem boolean not null default false);
      create temporary table os_itens (servico_id uuid references servicos_catalogo);
      insert into servicos_catalogo values ('00000000-0000-0000-0000-000000000011', null, 'global', true);
      insert into os_itens values ('00000000-0000-0000-0000-000000000011');`))
    await assert.rejects(tx.transaction(t => t.execute(sql.raw(readFileSync('src/lib/db/migrations/0210_servicos_concluir_contas.sql', 'utf8')))), (erro: unknown) => {
      assert.match((erro as { cause?: { message?: string } }).cause?.message ?? '', /OS ainda aponta para serviço global/)
      return true
    })
    const { rows } = await tx.execute(sql`select nome from servicos_catalogo`) as unknown as { rows: { nome: string }[] }
    assert.deepEqual(rows, [{ nome: 'global' }])
    throw new Desfazer()
  }), Desfazer)
})

test('conclusão preserva serviço global criado depois da cópia', async () => {
  await assert.rejects(db.transaction(async tx => {
    await tx.execute(sql.raw(`create temporary table servicos_catalogo (id uuid primary key, conta_id uuid, nome text not null, migracao_273_origem boolean not null default false);
      create temporary table os_itens (servico_id uuid references servicos_catalogo);
      insert into servicos_catalogo values ('00000000-0000-0000-0000-000000000011', null, 'novo', false);`))
    await assert.rejects(tx.transaction(t => t.execute(sql.raw(readFileSync('src/lib/db/migrations/0210_servicos_concluir_contas.sql', 'utf8')))), (erro: unknown) => {
      assert.match((erro as { cause?: { message?: string } }).cause?.message ?? '', /Serviço global criado após a cópia/)
      return true
    })
    const { rows } = await tx.execute(sql`select nome from servicos_catalogo`) as unknown as { rows: { nome: string }[] }
    assert.deepEqual(rows, [{ nome: 'novo' }])
    throw new Desfazer()
  }), Desfazer)
})
