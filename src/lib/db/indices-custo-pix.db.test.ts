// Teste de banco (#93): o custo do PIX entra no líquido de cada venda por uma subconsulta em pix_recebimentos_mcp
// (pela venda ou pelo pedido dela) e no MIN(numero) das vendas do pedido. Sem índice, cada venda varre a tabela
// inteira (o líquido de um ano ficou cerca de 100 vezes mais lento). Com a varredura desligada, o plano
// das três buscas tem de usar os índices da migração 0200; as de OS e peça (#94), os da 0201.
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { sql } from 'drizzle-orm'

const url = process.env.TEST_DATABASE_URL
if (!url || !['localhost', '127.0.0.1'].includes(new URL(url).hostname)) throw new Error('Use somente Postgres descartável local')
process.env.DATABASE_URL = url

let db: typeof import('@/lib/db')['db']
before(async () => { ({ db } = await import('@/lib/db')) })
after(async () => { await (globalThis as { __pgPool?: { end(): Promise<void> } }).__pgPool?.end() })

/** O plano da consulta com a varredura sequencial desligada, numa transação que não deixa nada. */
async function plano(consulta: ReturnType<typeof sql>) {
  return db.transaction(async tx => {
    await tx.execute(sql`set local enable_seqscan = off`)
    const r = (await tx.execute(sql`explain ${consulta}`)) as unknown as { rows: Record<string, string>[] }
    return r.rows.map(l => Object.values(l)[0]).join('\n')
  })
}

const ID = '00000000-0000-0000-0000-000000000000'

test('as buscas do custo do PIX por venda, por pedido e pelas vendas do pedido usam índice', async () => {
  assert.match(await plano(sql`select sum(custo_pix) from pix_recebimentos_mcp where venda_id = ${ID}`), /pix_recebimentos_mcp_venda_id_idx/)
  assert.match(await plano(sql`select sum(custo_pix) from pix_recebimentos_mcp where pedido_id = ${ID}`), /pix_recebimentos_mcp_pedido_id_idx/)
  assert.match(await plano(sql`select min(numero) from vendas where pedido_venda_id = ${ID}`), /vendas_pedido_venda_id_idx/)
})

// #94: o custo do PIX de cada OS e de cada venda de peça entra no Financeiro e no DRE pela mesma busca, por os_id e
// por peca_venda_id (migração 0201).
test('as buscas do custo do PIX por OS e por venda de peça usam índice', async () => {
  assert.match(await plano(sql`select sum(custo_pix) from pix_recebimentos_mcp where os_id = ${ID}`), /pix_recebimentos_mcp_os_id_idx/)
  assert.match(await plano(sql`select sum(custo_pix) from pix_recebimentos_mcp where peca_venda_id = ${ID}`), /pix_recebimentos_mcp_peca_venda_id_idx/)
})
