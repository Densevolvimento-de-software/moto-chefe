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
test('migração separa serviço usado por duas Contas e preserva os itens de OS', async () => {
  await assert.rejects(db.transaction(async tx => {
    await tx.execute(sql.raw(`
      create temporary table contas (id uuid primary key);
      create temporary table grupos (id uuid primary key, conta_id uuid references contas);
      create temporary table lojas (id uuid primary key, grupo_id uuid references grupos);
      create temporary table ordens_servico (id uuid primary key, loja_id uuid references lojas);
      create temporary table servicos_catalogo (id uuid primary key default gen_random_uuid(), nome text not null, conta_id uuid references contas, tempo_previsto_minutos integer, valor numeric(10,2) not null default 0, ativo boolean not null default true, criado_em timestamptz not null default now(), atualizado_em timestamptz not null default now());
      create temporary table os_itens (id uuid primary key default gen_random_uuid(), os_id uuid not null references ordens_servico, servico_id uuid references servicos_catalogo, tipo text not null, descricao text not null, valor_unitario numeric(10,2) not null);
      insert into contas values ('00000000-0000-0000-0000-000000000001'), ('00000000-0000-0000-0000-000000000002');
      insert into grupos values ('00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000001'), ('00000000-0000-0000-0000-000000000012','00000000-0000-0000-0000-000000000002');
      insert into lojas values ('00000000-0000-0000-0000-000000000021','00000000-0000-0000-0000-000000000011'), ('00000000-0000-0000-0000-000000000022','00000000-0000-0000-0000-000000000012');
      insert into ordens_servico values ('00000000-0000-0000-0000-000000000031','00000000-0000-0000-0000-000000000021'), ('00000000-0000-0000-0000-000000000032','00000000-0000-0000-0000-000000000022');
      insert into servicos_catalogo (id,nome,valor,tempo_previsto_minutos,ativo) values ('00000000-0000-0000-0000-000000000041','Revisão',100,45,false), ('00000000-0000-0000-0000-000000000042','Sem uso',50,null,true), ('00000000-0000-0000-0000-000000000043','Só A',30,15,true);
      insert into os_itens (os_id,servico_id,tipo,descricao,valor_unitario) values ('00000000-0000-0000-0000-000000000031','00000000-0000-0000-0000-000000000041','servico','Nome histórico A',80), ('00000000-0000-0000-0000-000000000031','00000000-0000-0000-0000-000000000041','servico','Outro item A',70), ('00000000-0000-0000-0000-000000000032','00000000-0000-0000-0000-000000000041','servico','Nome histórico B',90);
      insert into os_itens (os_id,servico_id,tipo,descricao,valor_unitario) values ('00000000-0000-0000-0000-000000000031','00000000-0000-0000-0000-000000000043','servico','Só A',30);
    `))
    await tx.execute(sql.raw(readFileSync('src/lib/db/migrations/0209_servicos_copias_por_conta.sql', 'utf8')))
    const { rows } = await tx.execute(sql`select c.conta_id, c.nome, c.valor, c.ativo, c.tempo_previsto_minutos, i.descricao, i.valor_unitario
      from os_itens i join servicos_catalogo c on c.id = i.servico_id order by c.conta_id, i.descricao`) as unknown as { rows: Record<string, string>[] }
    assert.deepEqual(rows.map(r => [r.conta_id?.slice(-1), r.nome, r.valor, r.ativo, r.tempo_previsto_minutos, r.descricao, r.valor_unitario]), [
      ['1', 'Revisão', '100.00', false, 45, 'Nome histórico A', '80.00'], ['1', 'Revisão', '100.00', false, 45, 'Outro item A', '70.00'], ['1', 'Só A', '30.00', true, 15, 'Só A', '30.00'], ['2', 'Revisão', '100.00', false, 45, 'Nome histórico B', '90.00'],
    ])
    const contagem = await tx.execute(sql`select count(*)::int n from servicos_catalogo`) as unknown as { rows: { n: number }[] }
    assert.equal(contagem.rows[0].n, 6)
    throw new Desfazer()
  }), Desfazer)
})

test('migração recusa OS sem Conta e preserva o serviço e seu vínculo', async () => {
  await assert.rejects(db.transaction(async tx => {
    await tx.execute(sql.raw(`
      create temporary table contas (id uuid primary key);
      create temporary table grupos (id uuid primary key, conta_id uuid references contas);
      create temporary table lojas (id uuid primary key, grupo_id uuid references grupos);
      create temporary table ordens_servico (id uuid primary key, loja_id uuid references lojas);
      create temporary table servicos_catalogo (id uuid primary key default gen_random_uuid(), nome text not null, conta_id uuid references contas, tempo_previsto_minutos integer, valor numeric(10,2) not null default 0, ativo boolean not null default true, criado_em timestamptz not null default now(), atualizado_em timestamptz not null default now());
      create temporary table os_itens (id uuid primary key default gen_random_uuid(), os_id uuid not null references ordens_servico, servico_id uuid references servicos_catalogo, tipo text not null, descricao text not null, valor_unitario numeric(10,2) not null);
      insert into grupos values ('00000000-0000-0000-0000-000000000011',null);
      insert into lojas values ('00000000-0000-0000-0000-000000000021','00000000-0000-0000-0000-000000000011');
      insert into ordens_servico values ('00000000-0000-0000-0000-000000000031','00000000-0000-0000-0000-000000000021');
      insert into servicos_catalogo (id,nome,valor) values ('00000000-0000-0000-0000-000000000041','Revisão',100);
      insert into os_itens (os_id,servico_id,tipo,descricao,valor_unitario) values ('00000000-0000-0000-0000-000000000031','00000000-0000-0000-0000-000000000041','servico','Original',80);
    `))
    await assert.rejects(tx.transaction(t => t.execute(sql.raw(readFileSync('src/lib/db/migrations/0209_servicos_copias_por_conta.sql', 'utf8')))), (erro: unknown) => {
      const causa = (erro as { cause?: { message?: string } }).cause
      assert.match(causa?.message ?? '', /OS com serviço sem Conta/)
      return true
    })
    const { rows } = await tx.execute(sql`select s.nome, i.descricao from os_itens i join servicos_catalogo s on s.id = i.servico_id`) as unknown as { rows: { nome: string; descricao: string }[] }
    assert.deepEqual(rows, [{ nome: 'Revisão', descricao: 'Original' }])
    throw new Desfazer()
  }), Desfazer)
})
