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

test('catálogo aceita serviço com Conta e cadastro antigo sem Conta', async () => {
  class Desfazer extends Error {}
  await assert.rejects(db.transaction(async tx => {
    await tx.execute(sql.raw(`create temporary table contas (id uuid primary key);
      create temporary table servicos_catalogo (id uuid primary key default gen_random_uuid(), nome text not null);
      insert into contas values ('00000000-0000-0000-0000-000000000001')`))
    await tx.execute(sql.raw(readFileSync('src/lib/db/migrations/0207_servicos_conta_coluna.sql', 'utf8')))
    const proprio = await tx.execute(sql`insert into servicos_catalogo (nome, conta_id) values ('SCC273 próprio', '00000000-0000-0000-0000-000000000001') returning conta_id`) as unknown as { rows: { conta_id: string | null }[] }
    const legado = await tx.execute(sql`insert into servicos_catalogo (nome) values ('SCC273 legado') returning conta_id`) as unknown as { rows: { conta_id: string | null }[] }
    assert.equal(proprio.rows[0].conta_id, '00000000-0000-0000-0000-000000000001')
    assert.equal(legado.rows[0].conta_id, null)
    await assert.rejects(tx.transaction(t => t.execute(sql`insert into servicos_catalogo (nome, conta_id) values ('SCC273 inválido', '00000000-0000-0000-0000-000000000000')`)))
    throw new Desfazer()
  }), Desfazer)
})
