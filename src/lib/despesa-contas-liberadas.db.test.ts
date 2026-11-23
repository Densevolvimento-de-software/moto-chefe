// Teste de banco: Postgres descartável, como src/lib/despesas-listas.db.test.ts.
// Prova que a lista de bancos liberados para despesa é lida só pelo grupo dono e que o banco recusa o mesmo banco duas vezes no grupo.
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { semearContaBase, type Base } from '@/test/semear-conta'

const url = process.env.TEST_DATABASE_URL
if (!url) throw new Error('TEST_DATABASE_URL não definida — este teste só roda num Postgres descartável')
if (!['localhost', '127.0.0.1'].includes(new URL(url).hostname)) {
  throw new Error('TEST_DATABASE_URL precisa ser loopback (Postgres descartável)')
}
process.env.DATABASE_URL = url

type Db = typeof import('@/lib/db')
type Tx = Parameters<Parameters<Db['db']['transaction']>[0]>[0]
let db: Db['db']
let liberadas: typeof import('@/lib/queries/despesa-contas-liberadas')
let schema: typeof import('@/lib/db/schema')

before(async () => {
  ;({ db } = await import('@/lib/db'))
  liberadas = await import('@/lib/queries/despesa-contas-liberadas')
  schema = await import('@/lib/db/schema')
})

after(async () => {
  await (globalThis as { __pgPool?: { end(): Promise<void> } }).__pgPool?.end()
})

class Desfazer extends Error {}

async function emTransacaoDesfeita(fn: (tx: Tx) => Promise<void>) {
  await assert.rejects(db.transaction(async tx => { await fn(tx); throw new Desfazer() }), Desfazer)
}

const BANCO_A = 'Banco A Empresas'
const INICIO = new Date('2026-09-01T03:00:00.000Z')

async function semearGrupo(tx: Tx, nome: string): Promise<Base> {
  return semearContaBase(tx, { prefixo: 'OFD209', nome: `${nome}-${randomUUID()}`, cnpj: randomUUID() })
}

test('liberação do grupo A volta com banco e início; o grupo B não vê nada disso', async () => {
  await emTransacaoDesfeita(async tx => {
    const a = await semearGrupo(tx, 'A')
    const b = await semearGrupo(tx, 'B')
    await tx.insert(schema.openFinanceContasDespesa).values({ grupoId: a.grupoId, banco: BANCO_A, inicioEm: INICIO })
    assert.deepEqual(await liberadas.contasLiberadasDespesa(a.grupoId, tx), [{ banco: BANCO_A, inicioEm: INICIO }])
    assert.deepEqual(await liberadas.contasLiberadasDespesa(b.grupoId, tx), [])
  })
})

test('grupo sem liberação nenhuma recebe lista vazia', async () => {
  await emTransacaoDesfeita(async tx => {
    const a = await semearGrupo(tx, 'vazio')
    assert.deepEqual(await liberadas.contasLiberadasDespesa(a.grupoId, tx), [])
  })
})

test('o mesmo banco não entra duas vezes no mesmo grupo', async () => {
  await emTransacaoDesfeita(async tx => {
    const a = await semearGrupo(tx, 'dup')
    await tx.insert(schema.openFinanceContasDespesa).values({ grupoId: a.grupoId, banco: BANCO_A, inicioEm: null })
    await assert.rejects(tx.insert(schema.openFinanceContasDespesa).values({ grupoId: a.grupoId, banco: BANCO_A, inicioEm: INICIO }))
  })
})
