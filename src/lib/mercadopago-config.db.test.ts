// Teste de banco: a credencial do Mercado Pago (mercadopago_config, #51) contra o schema real no
// Postgres descartável. Cada cenário roda numa transação desfeita e só usa o que ele mesmo semeou.
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { semearContaBase } from '@/test/semear-conta'

const url = process.env.TEST_DATABASE_URL
if (!url || !['localhost', '127.0.0.1'].includes(new URL(url).hostname)) throw new Error('Use somente Postgres descartável local')
process.env.DATABASE_URL = url

type Db = typeof import('@/lib/db')
type Tx = Parameters<Parameters<Db['db']['transaction']>[0]>[0]
let db: Db['db']

before(async () => {
  ;({ db } = await import('@/lib/db'))
})
after(async () => {
  await (globalThis as { __pgPool?: { end(): Promise<void> } }).__pgPool?.end()
})

class Desfazer extends Error {}
async function emTransacaoDesfeita(fn: (tx: Tx) => Promise<void>) {
  await assert.rejects(db.transaction(async tx => { await fn(tx); throw new Desfazer() }), Desfazer)
}

async function grupo(tx: Tx) {
  const suf = randomUUID()
  return (await semearContaBase(tx, { prefixo: 'MPCFG', nome: suf, cnpj: suf })).grupoId
}

const gravar = (tx: Tx, grupoId: string, userId: string) =>
  tx.execute(sql`insert into mercadopago_config (grupo_id, token, user_id) values (${grupoId}, 'iv:tag:dados', ${userId})`)

// O índice do cartão é por grupo e o transacao_id do Pix é único no sistema: a mesma conta em dois
// grupos gravaria a venda de uma Conta na outra.
test('a mesma conta do Mercado Pago não entra em dois grupos', async () => {
  await emTransacaoDesfeita(async tx => {
    const a = await grupo(tx)
    const b = await grupo(tx)
    const conta = `mp-${randomUUID()}`
    await gravar(tx, a, conta)
    await assert.rejects(
      tx.transaction(async sp => { await gravar(sp, b, conta) }),
      (e: unknown) => (e as { cause?: { code?: string } }).cause?.code === '23505' || (e as { code?: string }).code === '23505',
    )
  })
})

test('contas diferentes em grupos diferentes gravam', async () => {
  await emTransacaoDesfeita(async tx => {
    const a = await grupo(tx)
    const b = await grupo(tx)
    await gravar(tx, a, `mp-${randomUUID()}`)
    await gravar(tx, b, `mp-${randomUUID()}`)
    const { rows } = (await tx.execute(sql`select count(*)::int as n from mercadopago_config where grupo_id in (${a}, ${b})`)) as unknown as { rows: { n: number }[] }
    assert.equal(rows[0].n, 2)
  })
})
