// Teste de banco: "ligada a um recebimento" (aviso da edição da venda de peças, trava da OS). Linha estornada no
// Mercado Pago não conta: o dinheiro voltou ao cliente (#51).
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { semearContaBase, semearUsuario } from '@/test/semear-conta'
import { semearOs } from '@/test/semear-alvos-conciliacao'

const url = process.env.TEST_DATABASE_URL
if (!url || !['localhost', '127.0.0.1'].includes(new URL(url).hostname)) throw new Error('Use somente Postgres descartável local')
process.env.DATABASE_URL = url

let db: typeof import('@/lib/db')['db']
let alvoConciliado: typeof import('./alvo-conciliado')['alvoConciliado']
before(async () => {
  ;({ db } = await import('@/lib/db'))
  ;({ alvoConciliado } = await import('./alvo-conciliado'))
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
  return { venda: v.id as string, base, usuarioId }
}

test('linha aprovada ligada à venda: conciliada; estornada: não; sem linha: não', async () => {
  assert.equal(await alvoConciliado(db, { tipo: 'peca', id: (await vendaComLinha('aprovado')).venda }), true)
  assert.equal(await alvoConciliado(db, { tipo: 'peca', id: (await vendaComLinha('estornado')).venda }), false)
  assert.equal(await alvoConciliado(db, { tipo: 'peca', id: (await vendaComLinha(null)).venda }), false)
})

test('PIX do banco ligado à venda: conciliada', async () => {
  const { venda, base } = await vendaComLinha(null)
  await linhas(sql`insert into pix_recebimentos_mcp (grupo_id, conta_id, banco, transacao_id, data, valor, peca_venda_id, tipo_correspondencia)
    values (${base.grupoId}, 'conta-sintetica', 'banco', ${randomUUID()}, now(), 100, ${venda}, 'peca')`)
  assert.equal(await alvoConciliado(db, { tipo: 'peca', id: venda }), true)
})

test('OS: linha conciliada conta; a mesma linha estornada não', async () => {
  const { base, usuarioId } = await vendaComLinha(null)
  const os = await semearOs(db, { lojaId: base.lojaId, usuarioId, em: '2026-11-05 12:00:00-03' }, [{ tipo: 'cartao_credito', valor: 100 }])
  const [l] = await linhas(sql`insert into conciliacoes_cartao (grupo_id, operadora, data_transacao, nsu, valor_bruto, tipo, os_id, conciliado)
    values (${base.grupoId}, 'mercadopago', '2026-11-05', ${randomUUID()}, 100, 'credito', ${os}, true) returning id`)
  assert.equal(await alvoConciliado(db, { tipo: 'os', id: os }), true)
  await linhas(sql`update conciliacoes_cartao set status = 'estornado', conciliado = false where id = ${l.id}`)
  assert.equal(await alvoConciliado(db, { tipo: 'os', id: os }), false)
})
