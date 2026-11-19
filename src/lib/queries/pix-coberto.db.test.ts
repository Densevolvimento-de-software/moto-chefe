// Teste de banco (#90): as consultas que dizem se a venda, a OS e a venda de peça estão conciliadas contam o
// PIX pelo valor do PIX gravado na conciliação, não pelo que o banco creditou (já sem o custo do PIX).
// As consultas rodam de verdade no Postgres descartável; só a sessão é simulada (listagem de peças).
import { after, before, mock, test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { semearUsuario } from '@/test/semear-conta'
import { semearContaComAlvos, semearPixRecebido } from '@/test/semear-alvos-conciliacao'
import type { AlvoTipo } from '@/lib/conciliacao-alvo'

const url = process.env.TEST_DATABASE_URL
if (!url || !['localhost', '127.0.0.1'].includes(new URL(url).hostname)) throw new Error('Use somente Postgres descartável local')
process.env.DATABASE_URL = url

let usuario: Record<string, unknown> = {}
const mocks = [
  mock.module('@/lib/auth', { namedExports: { getUsuarioLogado: async () => usuario } }),
  mock.module('next/cache', { namedExports: { revalidatePath: () => {} } }),
  mock.module('next/headers', { namedExports: { cookies: async () => ({ get: () => undefined }) } }),
]

type Db = typeof import('@/lib/db')
let db: Db['db']
before(async () => { ({ db } = await import('@/lib/db')) })
after(async () => {
  for (const m of mocks) m.restore()
  await (globalThis as { __pgPool?: { end(): Promise<void> } }).__pgPool?.end()
})

const COLUNA: Record<AlvoTipo, { coluna: string; tipo: string }> = {
  moto: { coluna: 'venda_id', tipo: 'venda' }, os: { coluna: 'os_id', tipo: 'os' }, peca: { coluna: 'peca_venda_id', tipo: 'peca' },
}

// Conta com venda, OS e venda de peça pagas num PIX de R$ 10.000,00; cada uma com um PIX vinculado de `credito`.
async function contaComPixVinculado(credito: number, valorBruto: number | null) {
  const a = await semearContaComAlvos(db, 'PC90', [{ tipo: 'pix', valor: 10000 }])
  await db.execute(sql`update ordens_servico set valor_total = 10000 where id = ${a.alvos.os}`)
  for (const tipo of ['moto', 'os', 'peca'] as const) {
    const pix = await semearPixRecebido(db, a.grupoId, { valor: credito })
    await db.execute(sql`update pix_recebimentos_mcp set tipo_correspondencia = ${COLUNA[tipo].tipo},
      ${sql.raw(COLUNA[tipo].coluna)} = ${a.alvos[tipo]}, valor_bruto = ${valorBruto}, custo_pix = ${valorBruto === null ? null : valorBruto - credito},
      custo_pix_taxa = ${valorBruto === null ? null : 0.002} where id = ${pix}`)
  }
  return a
}

async function coberturaNasConsultas(a: Awaited<ReturnType<typeof contaComPixVinculado>>) {
  const { listarVendas } = await import('./vendas')
  const { pendenciasDeVendas } = await import('./pendencias-venda')
  const { getPendenciasConciliacaoLoja } = await import('./dashboard')
  const { listarOSPorLoja } = await import('./ordens-servico')
  const { listarVendasPecasAction } = await import('@/app/(dashboard)/pecas/actions')
  usuario = { id: await semearUsuario(db, a, { papel: 'admin_socio', rotulo: `socio-${randomUUID()}` }), papel: 'admin_socio', lojaId: a.lojaId, contaId: a.contaId, gruposAcesso: [a.grupoId], gruposAprovacao: [] }
  const pecas = await listarVendasPecasAction()
  return {
    vendas: Number((await listarVendas({ lojaId: [a.lojaId] })).find(v => v.id === a.alvos.moto)?.pixConciliadoValor),
    pendenciasConciliacao: (await pendenciasDeVendas({ lojaIds: [a.lojaId] })).porTipo.conciliacao,
    dashboard: await getPendenciasConciliacaoLoja(a.lojaId, new Date('2026-01-01T00:00:00Z')),
    os: Number((await listarOSPorLoja(a.lojaId)).find(o => o.id === a.alvos.os)?.pixConciliadoValor),
    pecas: Number(pecas.find(p => p.id === a.alvos.peca)?.pixConciliadoValor),
  }
}

test('PIX creditado R$ 9.980,00 com valor do PIX R$ 10.000,00 conta 10.000 em todas as consultas, e nada fica pendente', async () => {
  const a = await contaComPixVinculado(9980, 10000)
  const r = await coberturaNasConsultas(a)
  assert.deepEqual({ ...r, dashboard: { ...r.dashboard, semNotaFiscal: undefined } }, {
    vendas: 10000, pendenciasConciliacao: 0, os: 10000, pecas: 10000,
    dashboard: { semNotaFiscal: undefined, vendasPendentes: 0, osPendentes: 0, pecasPendentes: 0 },
  })
})

test('PIX vinculado antes do custo (sem valor do PIX gravado) segue contando o crédito', async () => {
  const a = await contaComPixVinculado(10000, null)
  const r = await coberturaNasConsultas(a)
  assert.deepEqual([r.vendas, r.os, r.pecas, r.pendenciasConciliacao, r.dashboard.vendasPendentes], [10000, 10000, 10000, 0, 0])
})
