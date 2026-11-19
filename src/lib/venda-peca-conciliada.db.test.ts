// Teste de banco: o aviso "ligada a um recebimento" da edição da venda de peças (#51). Linha estornada no Mercado Pago
// não conta: o dinheiro voltou ao cliente.
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { semearContaBase, semearUsuario } from '@/test/semear-conta'

const url = process.env.TEST_DATABASE_URL
if (!url || !['localhost', '127.0.0.1'].includes(new URL(url).hostname)) throw new Error('Use somente Postgres descartável local')
process.env.DATABASE_URL = url

let db: typeof import('@/lib/db')['db']
let vendaPecaConciliada: typeof import('./venda-peca-conciliada')['vendaPecaConciliada']
before(async () => {
  ;({ db } = await import('@/lib/db'))
  ;({ vendaPecaConciliada } = await import('./venda-peca-conciliada'))
})
after(async () => { await (globalThis as { __pgPool?: { end(): Promise<void> } }).__pgPool?.end() })

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const linhas = async (q: ReturnType<typeof sql>) => ((await db.execute(q)) as unknown as { rows: any[] }).rows

async function vendaComLinha(status: string | null) {
  const suf = randomUUID()
  const base = await semearContaBase(db, { prefixo: 'VPCONC', nome: suf, cnpj: suf })
  const usuarioId = await semearUsuario(db, base, { papel: 'aux_adm' })
  const [v] = await linhas(sql`insert into vendas_pecas (loja_id, vendedor_id, forma_pagamento, pagamentos, valor_total, data_venda)
    values (${base.lojaId}, ${usuarioId}, 'cartao_credito', '[]'::jsonb, 100, now()) returning id`)
  if (status) {
    await linhas(sql`insert into conciliacoes_cartao (grupo_id, operadora, data_transacao, nsu, valor_bruto, tipo, peca_venda_id, conciliado, status)
      values (${base.grupoId}, 'mercadopago', '2026-11-05', ${randomUUID()}, 100, 'credito', ${v.id}, ${status !== 'estornado'}, ${status})`)
  }
  return { venda: v.id as string, base }
}

test('linha aprovada ligada à venda: conciliada; estornada: não; sem linha: não', async () => {
  assert.equal(await vendaPecaConciliada(db, (await vendaComLinha('aprovado')).venda), true)
  assert.equal(await vendaPecaConciliada(db, (await vendaComLinha('estornado')).venda), false)
  assert.equal(await vendaPecaConciliada(db, (await vendaComLinha(null)).venda), false)
})

test('PIX do banco ligado à venda: conciliada', async () => {
  const { venda, base } = await vendaComLinha(null)
  await linhas(sql`insert into pix_recebimentos_mcp (grupo_id, conta_id, banco, transacao_id, data, valor, peca_venda_id, tipo_correspondencia)
    values (${base.grupoId}, 'conta-sintetica', 'banco', ${randomUUID()}, now(), 100, ${venda}, 'peca')`)
  assert.equal(await vendaPecaConciliada(db, venda), true)
})
