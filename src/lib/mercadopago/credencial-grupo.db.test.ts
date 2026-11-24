// Teste de banco: o cadastro de maquininhas sabe se o grupo tem credencial do Mercado Pago (#205),
// e só do próprio grupo: a Conta B, sem credencial, não vê a da Conta A.
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { semearContaBase } from '@/test/semear-conta'

const url = process.env.TEST_DATABASE_URL
if (!url || !['localhost', '127.0.0.1'].includes(new URL(url).hostname)) throw new Error('Use somente Postgres descartável local')
process.env.DATABASE_URL = url
process.env.CERT_MASTER_KEY ??= 'c'.repeat(64)

let db: typeof import('@/lib/db')['db']
let temCredencialMercadoPago: typeof import('./credencial')['temCredencialMercadoPago']

before(async () => {
  ;({ db } = await import('@/lib/db'))
  ;({ temCredencialMercadoPago } = await import('./credencial'))
})
after(async () => {
  await (globalThis as { __pgPool?: { end(): Promise<void> } }).__pgPool?.end()
})

async function semearGrupo(comCredencial: boolean) {
  const suf = randomUUID()
  const base = await semearContaBase(db, { prefixo: 'MPCTELA', nome: `MPCTELA ${suf}`, cnpj: suf })
  if (comCredencial) {
    await db.execute(sql`insert into mercadopago_config (grupo_id, token, user_id) values (${base.grupoId}, ${'x'}, ${'mp-' + suf})`)
  }
  return base.grupoId
}

test('grupo com credencial do Mercado Pago responde que sim; sem, que não (#205)', async () => {
  const comCredencial = await semearGrupo(true)
  const semCredencial = await semearGrupo(false)
  assert.equal(await temCredencialMercadoPago(comCredencial), true)
  assert.equal(await temCredencialMercadoPago(semCredencial), false)
})

test('a credencial de outra Conta não aparece para o grupo sem credencial (#205)', async () => {
  const contaA = await semearGrupo(true)
  const contaB = await semearGrupo(false)
  assert.equal(await temCredencialMercadoPago(contaB), false)
  assert.equal(await temCredencialMercadoPago(contaA), true)
})
