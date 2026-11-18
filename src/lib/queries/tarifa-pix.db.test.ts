// Teste de banco: a tarifa do Pix da maquininha Mercado Pago sai da "taxa de cartão" e vira linha
// própria no DRE (decisão do Luis, #51), sem mudar a soma das duas. Roda as consultas de verdade
// contra o Postgres descartável; cada teste usa só as lojas que semeou.
import { before, after, test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { semearContaBase, semearUsuario } from '@/test/semear-conta'

const url = process.env.TEST_DATABASE_URL
if (!url || !['localhost', '127.0.0.1'].includes(new URL(url).hostname)) throw new Error('Use somente Postgres descartável local')
process.env.DATABASE_URL = url

let db: typeof import('@/lib/db')['db']
let dre: typeof import('@/lib/queries/dre')

before(async () => {
  ;({ db } = await import('@/lib/db'))
  dre = await import('@/lib/queries/dre')
})
after(async () => {
  await (globalThis as { __pgPool?: { end(): Promise<void> } }).__pgPool?.end()
})

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const linhas = async (q: ReturnType<typeof sql>) => ((await db.execute(q)) as unknown as { rows: any[] }).rows

async function semearConta() {
  const suf = randomUUID()
  const base = await semearContaBase(db, { prefixo: 'TARPIX', nome: suf, cnpj: suf })
  const usuarioId = await semearUsuario(db, base, { papel: 'aux_adm' })
  const [modelo] = await linhas(sql`insert into modelos (marca, modelo, categoria, potencia_w, motor, velocidade_max)
    values ('M', ${'TARPIX ' + suf}, 'autopropelido', '1000', 'hub', '32') returning id`)
  return { ...base, usuarioId, modeloId: modelo.id as string }
}
type Conta = Awaited<ReturnType<typeof semearConta>>

async function vendaMoto(c: Conta, valor: number, quando: string) {
  const [moto] = await linhas(sql`insert into motos (chassi, modelo_id, loja_id, cor, nota_fiscal_entrada, status, disponibilidade)
    values (${randomUUID()}, ${c.modeloId}, ${c.lojaId}, 'CINZA', '1', 'vendida', 'vendida') returning id`)
  const [pedido] = await linhas(sql`insert into pedidos_venda (moto_id, loja_id, vendedor_id) values (${moto.id}, ${c.lojaId}, ${c.usuarioId}) returning id`)
  const [v] = await linhas(sql`insert into vendas (pedido_venda_id, moto_id, loja_id, vendedor_id, efetivado_por, cliente_nome, cliente_cpf, valor, forma_pagamento, pagamentos, data_venda)
    values (${pedido.id}, ${moto.id}, ${c.lojaId}, ${c.usuarioId}, ${c.usuarioId}, 'Cliente sintético', '52998224725', ${valor}, 'pix', '[]'::jsonb, ${quando}::timestamptz) returning id`)
  return v.id as string
}
async function vendaPeca(c: Conta, valor: number, quando: string) {
  const [p] = await linhas(sql`insert into vendas_pecas (loja_id, vendedor_id, forma_pagamento, pagamentos, valor_total, data_venda)
    values (${c.lojaId}, ${c.usuarioId}, 'pix', '[]'::jsonb, ${valor}, ${quando}::timestamptz) returning id`)
  return p.id as string
}
async function osConcluida(c: Conta, valor: number, quando: string) {
  const [o] = await linhas(sql`insert into ordens_servico (loja_id, aberta_por, descricao, status, valor_servicos, data_conclusao)
    values (${c.lojaId}, ${c.usuarioId}, 'revisão', 'concluida', ${valor}, ${quando}::timestamptz) returning id`)
  return o.id as string
}

type Alvo = { venda?: string; peca?: string; os?: string }
async function linhaConciliada(c: Conta, tipo: 'credito' | 'pix', bruto: number, liquido: number, alvo: Alvo, conciliado = true) {
  await db.execute(sql`insert into conciliacoes_cartao (grupo_id, operadora, data_transacao, nsu, valor_bruto, valor_liquido, tipo, venda_id, peca_venda_id, os_id, conciliado)
    values (${c.grupoId}, 'mercadopago', '2026-10-15', ${randomUUID()}, ${bruto}, ${liquido}, ${tipo},
      ${alvo.venda ?? null}, ${alvo.peca ?? null}, ${alvo.os ?? null}, ${conciliado})`)
}

// Outubro de 2026: moto, peça e OS, cada uma com cartão e/ou Pix do Mercado Pago.
//   moto  10.000: crédito 6.000 (líquido 5.800, taxa 200) + Pix 4.000 (líquido 3.996, tarifa 4)
//   peça     500: crédito   300 (líquido   291, taxa   9) + Pix   200 (líquido   199, tarifa 1)
//   OS       800: Pix 800 (líquido 796, tarifa 4)
// Taxa de cartão 209; tarifa do Pix 9; soma 218, que é o que a "taxa de cartão" mostrava antes.
async function semearOutubro(c: Conta) {
  const moto = await vendaMoto(c, 10_000, '2026-10-15 12:00:00-03')
  await linhaConciliada(c, 'credito', 6_000, 5_800, { venda: moto })
  await linhaConciliada(c, 'pix', 4_000, 3_996, { venda: moto })
  const peca = await vendaPeca(c, 500, '2026-10-16 12:00:00-03')
  await linhaConciliada(c, 'credito', 300, 291, { peca })
  await linhaConciliada(c, 'pix', 200, 199, { peca })
  const os = await osConcluida(c, 800, '2026-10-17 12:00:00-03')
  await linhaConciliada(c, 'pix', 800, 796, { os })
}

test('DRE do mês: taxa de cartão só do cartão, tarifa do Pix só do Pix, soma igual à de antes', async () => {
  const a = await semearConta()
  await semearOutubro(a)
  const { colunas } = await dre.dreDoMes({ grupoId: a.grupoId, lojaIds: [a.lojaId], ano: 2026, mes: 10 })
  const e = colunas.find(c => c.chave === a.lojaId)!.entrada
  assert.equal(e.taxasCartao, 209)
  assert.equal(e.tarifaPix, 9)
  assert.equal(e.taxasCartao + e.tarifaPix, 218)
})

test('DRE por mês: a mesma separação no mês certo', async () => {
  const a = await semearConta()
  await semearOutubro(a)
  const meses = await dre.dreEvolucao({ grupoId: a.grupoId, lojaIds: [a.lojaId], ano: 2026, mes: 10, meses: 2 })
  const outubro = meses.find(m => m.mes === 10)!.entrada
  const setembro = meses.find(m => m.mes === 9)!.entrada
  assert.equal(outubro.taxasCartao, 209)
  assert.equal(outubro.tarifaPix, 9)
  assert.equal(setembro.tarifaPix, 0)
})

test('Pix de outra Conta, não conciliado ou de outro mês não entra na tarifa', async () => {
  const a = await semearConta()
  const b = await semearConta()
  await semearOutubro(a)
  await linhaConciliada(b, 'pix', 7_000, 6_930, { venda: await vendaMoto(b, 7_000, '2026-10-15 12:00:00-03') })
  await linhaConciliada(a, 'pix', 1_000, 990, { peca: await vendaPeca(a, 1_000, '2026-10-18 12:00:00-03') }, false)
  await linhaConciliada(a, 'pix', 2_000, 1_950, { peca: await vendaPeca(a, 2_000, '2026-09-18 12:00:00-03') })
  const { colunas } = await dre.dreDoMes({ grupoId: a.grupoId, lojaIds: [a.lojaId], ano: 2026, mes: 10 })
  assert.equal(colunas.find(c => c.chave === a.lojaId)!.entrada.tarifaPix, 9)
})
