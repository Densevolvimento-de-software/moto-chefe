// Migração 0212 (#321 e #322): o check de log_acoes.tipo aceita os tipos novos de TIPOS_LOG e nenhum outro.
// Cada inserção fica numa transação que se desfaz: o teste não deixa linha no banco compartilhado do test:db.
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'

const url = process.env.TEST_DATABASE_URL
if (!url || !['localhost', '127.0.0.1'].includes(new URL(url).hostname)) throw new Error('Use somente Postgres descartável local')
process.env.DATABASE_URL = url

// Import dinâmico: o módulo de banco lê DATABASE_URL ao carregar, então tem de vir depois do ajuste acima.
let db: typeof import('@/lib/db')['db']
let execRows: typeof import('@/lib/db')['execRows']
let TIPOS_LOG: readonly string[]
before(async () => {
  ;({ db, execRows } = await import('@/lib/db'))
  ;({ TIPOS_LOG } = await import('@/lib/log-acoes'))
})
after(async () => { await (globalThis as { __pgPool?: { end(): Promise<void> } }).__pgPool?.end() })

const NOVOS = ['loja_motochefe_alterada', 'autorizacao_conta_alterada', 'api_chave_gerada', 'api_chave_trocada', 'api_chave_revogada']

class Desfazer extends Error {}
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

// Roda o corpo e desfaz tudo. Erro do banco (check recusado) sai como erro, não é engolido.
async function comTransacaoDesfeita(corpo: (tx: Tx) => Promise<void>) {
  try {
    await db.transaction(async tx => { await corpo(tx); throw new Desfazer() })
  } catch (e) {
    if (!(e instanceof Desfazer)) throw e
  }
}

const inserirLog = (tx: Tx, tipo: string) =>
  tx.execute(sql`insert into log_acoes (usuario_id, tipo, dia) values (${randomUUID()}, ${tipo}, current_date)`)

test('o check aceita os cinco tipos novos da #321 e da #322', async () => {
  await comTransacaoDesfeita(async tx => { for (const tipo of NOVOS) await inserirLog(tx, tipo) })
})

test('o check recusa um tipo inventado', async () => {
  // O Drizzle embrulha o erro do Postgres: o nome do check fica em `cause`.
  await assert.rejects(
    db.transaction(async tx => { await inserirLog(tx, 'tipo_inventado_pelo_teste') }),
    (e: Error & { cause?: Error }) => /log_acoes_tipo_check/.test(`${e.message} ${e.cause?.message ?? ''}`),
  )
})

test('a lista do check é a mesma de TIPOS_LOG, e os cinco novos estão nas duas', async () => {
  const [linha] = await execRows(sql`
    select pg_get_constraintdef(c.oid) as definicao from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    where t.relname = 'log_acoes' and c.conname = 'log_acoes_tipo_check'`)
  assert.ok(linha, 'log_acoes_tipo_check não existe')
  const noCheck = [...String(linha.definicao).matchAll(/'([a-z_]+)'/g)].map(m => m[1]).sort()
  assert.deepEqual(noCheck, [...TIPOS_LOG].sort())
  for (const tipo of NOVOS) assert.ok(TIPOS_LOG.includes(tipo), `${tipo} fora de TIPOS_LOG`)
})
