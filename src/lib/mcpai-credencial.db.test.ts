// Teste de banco: a credencial do mcp.ai lida da linha do grupo (#236). Chave cifrada, grupo e CNPJ rodam no
// Postgres descartável; a env global é a da fronteira, simulada.
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { semearContaBase } from '@/test/semear-conta'

const url = process.env.TEST_DATABASE_URL
if (!url || !['localhost', '127.0.0.1'].includes(new URL(url).hostname)) throw new Error('Use somente Postgres descartável local')
process.env.DATABASE_URL = url
process.env.CERT_MASTER_KEY ??= 'c'.repeat(64)
const GLOBAL = 'https://api.mcp.ai/global/token-global-ficticio'
const envOriginal = process.env.MCPAI_ENDPOINT_URL
process.env.MCPAI_ENDPOINT_URL = GLOBAL

let db: typeof import('@/lib/db')['db']
let cifrar: typeof import('@/lib/cripto')['cifrar']
let credencialMcpDoGrupo: typeof import('./mcpai-credencial')['credencialMcpDoGrupo']
before(async () => {
  ;({ db } = await import('@/lib/db'))
  ;({ cifrar } = await import('@/lib/cripto'))
  ;({ credencialMcpDoGrupo } = await import('./mcpai-credencial'))
})
after(async () => {
  if (envOriginal === undefined) delete process.env.MCPAI_ENDPOINT_URL
  else process.env.MCPAI_ENDPOINT_URL = envOriginal
  await (globalThis as { __pgPool?: { end(): Promise<void> } }).__pgPool?.end()
})

// CNPJ só de dígitos e único: a leitura acha o grupo pelos dígitos entre todos os grupos ativos do banco.
const cnpjNovo = () => String(Math.floor(Math.random() * 1e14)).padStart(14, '0')

async function grupo(o: { chave: string | null; ids: string[] }) {
  const cnpj = cnpjNovo()
  const base = await semearContaBase(db, { prefixo: 'MCPCRED', nome: randomUUID(), cnpj })
  await db.execute(sql`update grupos set mcpai_endpoint_url = ${o.chave ? cifrar(o.chave) : null},
    mcpai_contas_pix_ids = ${sql.param(o.ids)}::text[] where id = ${base.grupoId}`)
  return { cnpj }
}

test('grupo com chave própria devolve a chave dele e só os ids dele', async () => {
  const a = await grupo({ chave: 'https://api.mcp.ai/a/token-a-ficticio', ids: ['conta-de-a'] })
  const b = await grupo({ chave: 'https://api.mcp.ai/b/token-b-ficticio', ids: ['conta-de-b'] })
  assert.deepEqual(await credencialMcpDoGrupo(a.cnpj), { url: 'https://api.mcp.ai/a/token-a-ficticio', chavePropria: true, contasPixIds: ['conta-de-a'] })
  assert.deepEqual((await credencialMcpDoGrupo(b.cnpj)).contasPixIds, ['conta-de-b'])
})

test('grupo na chave global ignora ids que estejam gravados', async () => {
  const g = await grupo({ chave: null, ids: ['conta-gravada-por-fora'] })
  assert.deepEqual(await credencialMcpDoGrupo(g.cnpj), { url: GLOBAL, chavePropria: false, contasPixIds: [] })
})
