// Teste de banco (#93): o líquido da venda de moto desconta o custo do PIX, nas duas formas da regra
// (valorLiquidoExpr, em Drizzle, e valorLiquidoSql, em SQL cru com alias), contra o Postgres descartável.
// Cada teste usa só as vendas que semeou.
import { before, after, test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { eq, sql } from 'drizzle-orm'
import { semearContaBase, semearUsuario } from '@/test/semear-conta'

const url = process.env.TEST_DATABASE_URL
if (!url || !['localhost', '127.0.0.1'].includes(new URL(url).hostname)) throw new Error('Use somente Postgres descartável local')
process.env.DATABASE_URL = url

let db: typeof import('@/lib/db')['db']
let vl: typeof import('@/lib/queries/valor-liquido')
let vendas: typeof import('@/lib/db/schema')['vendas']
let dre: typeof import('@/lib/queries/dre')
let contabil: typeof import('@/lib/queries/export-contabil')

before(async () => {
  ;({ db } = await import('@/lib/db'))
  vl = await import('@/lib/queries/valor-liquido')
  ;({ vendas } = await import('@/lib/db/schema'))
  dre = await import('@/lib/queries/dre')
  contabil = await import('@/lib/queries/export-contabil')
})
after(async () => {
  await (globalThis as { __pgPool?: { end(): Promise<void> } }).__pgPool?.end()
})

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const linhas = async (q: ReturnType<typeof sql>) => ((await db.execute(q)) as unknown as { rows: any[] }).rows

async function semearConta() {
  const suf = randomUUID()
  const base = await semearContaBase(db, { prefixo: 'LIQ93', nome: suf, cnpj: suf })
  const usuarioId = await semearUsuario(db, base, { papel: 'aux_adm' })
  const [modelo] = await linhas(sql`insert into modelos (marca, modelo, categoria, potencia_w, motor, velocidade_max)
    values ('M', ${'LIQ93 ' + suf}, 'autopropelido', '1000', 'hub', '32') returning id`)
  return { ...base, usuarioId, modeloId: modelo.id as string }
}
type Conta = Awaited<ReturnType<typeof semearConta>>

async function novoPedido(c: Conta) {
  const [moto] = await linhas(sql`insert into motos (chassi, modelo_id, loja_id, cor, nota_fiscal_entrada, status, disponibilidade)
    values (${randomUUID()}, ${c.modeloId}, ${c.lojaId}, 'CINZA', '1', 'vendida', 'vendida') returning id`)
  const [pedido] = await linhas(sql`insert into pedidos_venda (moto_id, loja_id, vendedor_id) values (${moto.id}, ${c.lojaId}, ${c.usuarioId}) returning id`)
  return pedido.id as string
}
async function vendaMoto(c: Conta, valor: number, pagamentos: unknown[] = [], pedidoId?: string) {
  const pedido = pedidoId ?? await novoPedido(c)
  const [moto] = await linhas(sql`insert into motos (chassi, modelo_id, loja_id, cor, nota_fiscal_entrada, status, disponibilidade)
    values (${randomUUID()}, ${c.modeloId}, ${c.lojaId}, 'CINZA', '1', 'vendida', 'vendida') returning id`)
  const [v] = await linhas(sql`insert into vendas (pedido_venda_id, moto_id, loja_id, vendedor_id, efetivado_por, cliente_nome, cliente_cpf, valor, forma_pagamento, pagamentos, data_venda)
    values (${pedido}, ${moto.id}, ${c.lojaId}, ${c.usuarioId}, ${c.usuarioId}, 'Cliente sintético', '52998224725', ${valor}, 'multiplos', ${JSON.stringify(pagamentos)}::jsonb, '2026-11-10 12:00:00-03') returning id`)
  return { venda: v.id as string, pedido }
}
async function cartaoConciliado(c: Conta, venda: string, bruto: number, liquido: number) {
  await db.execute(sql`insert into conciliacoes_cartao (grupo_id, operadora, data_transacao, nsu, valor_bruto, valor_liquido, tipo, venda_id, conciliado)
    values (${c.grupoId}, 'cielo', '2026-11-10', ${randomUUID()}, ${bruto}, ${liquido}, 'credito', ${venda}, true)`)
}
/** PIX recebido do banco já vinculado (o que o vínculo grava: crédito, valor do PIX, custo e taxa). */
async function pixVinculado(grupoId: string, alvo: { venda?: string; pedido?: string }, credito: number, bruto: number, custo: number, tipo = 'PIX') {
  await db.execute(sql`insert into pix_recebimentos_mcp (grupo_id, conta_id, banco, transacao_id, data, valor, pagador_nome, tipo_operacao,
      tipo_correspondencia, venda_id, pedido_id, valor_bruto, custo_pix, custo_pix_taxa)
    values (${grupoId}, 'conta-sintetica', 'Banco sintético', ${randomUUID()}, now(), ${credito}, 'Pagador sintético', ${tipo},
      ${alvo.venda ? 'venda' : 'pedido'}, ${alvo.venda ?? null}, ${alvo.pedido ?? null}, ${bruto}, ${custo}, ${bruto > 0 ? custo / bruto : 0})`)
}

/** O líquido da venda pelas duas formas da regra; as duas têm de dar o mesmo. */
async function liquido(venda: string) {
  const [expr] = await db.select({ l: sql<string>`${vl.valorLiquidoExpr()}` }).from(vendas).where(eq(vendas.id, venda))
  const [cru] = await linhas(sql`select ${vl.valorLiquidoSql('v')} as l from vendas v where v.id = ${venda}`)
  assert.equal(Number(expr.l), Number(cru.l), 'as duas formas do líquido')
  return Number(expr.l)
}

test('aceite da #93: R$ 18.500 com PIX de 10.000 (custo 20) e cartão de 8.500 (taxa 612) dá líquido 17.868 nas duas formas', async () => {
  const c = await semearConta()
  const { venda } = await vendaMoto(c, 18_500, [{ tipo: 'pix', valor: 10_000 }, { tipo: 'cartao_credito', valor: 8_500 }])
  await cartaoConciliado(c, venda, 8_500, 7_888)
  await pixVinculado(c.grupoId, { venda }, 9_980, 10_000, 20)
  assert.equal(await liquido(venda), 17_868)
})

test('PIX ligado ao pedido: o custo inteiro sai da 1ª venda do pedido; a 2ª não muda e a soma bate', async () => {
  const c = await semearConta()
  const primeira = await vendaMoto(c, 10_000)
  const segunda = await vendaMoto(c, 8_000, [], primeira.pedido)
  await pixVinculado(c.grupoId, { pedido: primeira.pedido }, 2_994, 3_000, 6)
  assert.deepEqual([await liquido(primeira.venda), await liquido(segunda.venda)], [9_994, 8_000])
})

test('forçada de PIX: o custo gravado na marca sai do líquido', async () => {
  const c = await semearConta()
  const marca = { motivo: 'Caiu na conta pessoal', porId: c.usuarioId, porNome: 'Aux', em: '2026-11-10T12:00:00.000Z',
    pix: { valorRecebido: 5_978.02, valorBruto: 5_990, custoPix: 11.98, custoPixTaxa: 0.002 } }
  const { venda } = await vendaMoto(c, 5_990, [{ tipo: 'pix', valor: 5_990, conciliadoManual: marca }])
  assert.equal(await liquido(venda), 5_978.02)
})

test('PIX não conciliado, TED e grupo com taxa 0: líquido igual ao valor', async () => {
  const c = await semearConta()
  const { venda } = await vendaMoto(c, 5_000, [{ tipo: 'pix', valor: 5_000 }])
  // Um PIX livre (sem vínculo) do grupo, uma TED vinculada (custo 0) e um PIX de grupo com taxa 0 (custo 0).
  await db.execute(sql`insert into pix_recebimentos_mcp (grupo_id, conta_id, banco, transacao_id, data, valor, pagador_nome, tipo_operacao)
    values (${c.grupoId}, 'conta-sintetica', 'Banco sintético', ${randomUUID()}, now(), 4990, 'Livre', 'PIX')`)
  await pixVinculado(c.grupoId, { venda }, 2_000, 2_000, 0, 'TED')
  await pixVinculado(c.grupoId, { venda }, 3_000, 3_000, 0)
  assert.equal(await liquido(venda), 5_000)
})

test('Conta A × B: PIX da Conta A apontando para a venda da B não desconta nada na B', async () => {
  const a = await semearConta()
  const b = await semearConta()
  const { venda } = await vendaMoto(b, 10_000, [{ tipo: 'pix', valor: 10_000 }])
  await pixVinculado(a.grupoId, { venda }, 9_980, 10_000, 20)
  assert.equal(await liquido(venda), 10_000)
})

// Decisão do Luis registrada na #93: no DRE o custo do PIX é linha própria; "Taxas de cartão" não muda, e as
// deduções somam o bruto − líquido. A contabilidade soma o custo do PIX nas taxas e no líquido.
test('DRE e contabilidade: custo do PIX em linha própria, taxa de cartão igual, e a soma das partes bate', async () => {
  const c = await semearConta()
  const { venda } = await vendaMoto(c, 18_500, [{ tipo: 'pix', valor: 10_000 }, { tipo: 'cartao_credito', valor: 8_500 }])
  await cartaoConciliado(c, venda, 8_500, 7_888)
  await pixVinculado(c.grupoId, { venda }, 9_980, 10_000, 20)
  const { colunas } = await dre.dreDoMes({ grupoId: c.grupoId, lojaIds: [c.lojaId], ano: 2026, mes: 11 })
  const e = colunas.find(x => x.chave === c.lojaId)!.entrada
  assert.deepEqual([e.taxasCartao, e.tarifaPix, e.custoPix], [612, 0, 20])
  assert.equal(e.taxasCartao + e.tarifaPix + e.custoPix, 18_500 - await liquido(venda))
  const [mes] = await dre.dreEvolucao({ grupoId: c.grupoId, lojaIds: [c.lojaId], ano: 2026, mes: 11, meses: 1 })
  assert.deepEqual([mes.entrada.taxasCartao, mes.entrada.custoPix], [612, 20])
  const exp = await contabil.dadosExportContabil({ grupo: { id: c.grupoId, nome: 'G' }, lojaIds: [c.lojaId], competencias: [{ ano: 2026, mes: 11 }] })
  const linha = exp.vendas.find(v => v.valorBruto === 18_500)!
  assert.deepEqual([linha.taxas, linha.valorLiquido], [632, 17_868])
})
