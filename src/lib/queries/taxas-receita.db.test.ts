// Teste de banco: a tarifa do Pix da maquininha Mercado Pago sai da "taxa de cartão" e vira linha
// própria no DRE (decisão do Luis, #51), sem mudar a soma das duas. Roda as consultas de verdade
// contra o Postgres descartável; cada teste usa só as lojas que semeou.
import { before, after, test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { semearContaBase, semearUsuario } from '@/test/semear-conta'
import { semearPixRecebido } from '@/test/semear-alvos-conciliacao'

const url = process.env.TEST_DATABASE_URL
if (!url || !['localhost', '127.0.0.1'].includes(new URL(url).hostname)) throw new Error('Use somente Postgres descartável local')
process.env.DATABASE_URL = url

let db: typeof import('@/lib/db')['db']
let dre: typeof import('@/lib/queries/dre')
let taxas: typeof import('@/lib/queries/taxas-receita')

before(async () => {
  ;({ db } = await import('@/lib/db'))
  dre = await import('@/lib/queries/dre')
  taxas = await import('@/lib/queries/taxas-receita')
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
async function linhaConciliada(c: Conta, tipo: 'credito' | 'pix', bruto: number, liquido: number | null, alvo: Alvo, conciliado = true) {
  await db.execute(sql`insert into conciliacoes_cartao (grupo_id, operadora, data_transacao, nsu, valor_bruto, valor_liquido, tipo, venda_id, peca_venda_id, os_id, conciliado)
    values (${c.grupoId}, 'mercadopago', '2026-10-15', ${randomUUID()}, ${bruto}, ${liquido}, ${tipo},
      ${alvo.venda ?? null}, ${alvo.peca ?? null}, ${alvo.os ?? null}, ${conciliado})`)
}

// Outubro de 2026: moto, peça e OS, cada uma com cartão e/ou Pix do Mercado Pago.
//   moto  10.000: crédito 6.000 (líquido 5.800, taxa 200) + Pix 4.000 (líquido 3.996, tarifa 4)
//   peça     500: crédito   300 (líquido   291, taxa   9) + Pix   200 (líquido   199, tarifa 1)
//   OS       800: Pix 800 (líquido 796, tarifa 4)
// Taxa de cartão 209; tarifa do Pix 9.
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

// A conta de antes, escrita aqui à parte: a "taxa de cartão" juntava tudo (moto: bruto − líquido, linha sem
// líquido conta inteira; OS concluída e peça: bruto − líquido, sem líquido conta zero).
async function taxaDeAntes(lojaIds: string[], inicio: string, fim: string) {
  const [r] = await linhas(sql`
    select coalesce((select sum(c.valor_bruto::numeric - coalesce(c.valor_liquido::numeric, 0))
                       from conciliacoes_cartao c join vendas v on v.id = c.venda_id
                      where c.conciliado and v.loja_id = any(${sql.param(lojaIds)}::uuid[])
                        and v.data_venda >= ${inicio} and v.data_venda < ${fim}), 0) as moto,
           coalesce((select sum(c.valor_bruto::numeric - coalesce(c.valor_liquido::numeric, c.valor_bruto::numeric))
                       from conciliacoes_cartao c join ordens_servico o on o.id = c.os_id
                      where c.conciliado and o.status = 'concluida' and o.loja_id = any(${sql.param(lojaIds)}::uuid[])
                        and o.data_conclusao >= ${inicio} and o.data_conclusao < ${fim}), 0)
         + coalesce((select sum(c.valor_bruto::numeric - coalesce(c.valor_liquido::numeric, c.valor_bruto::numeric))
                       from conciliacoes_cartao c join vendas_pecas p on p.id = c.peca_venda_id
                      where c.conciliado and p.loja_id = any(${sql.param(lojaIds)}::uuid[])
                        and p.data_venda >= ${inicio} and p.data_venda < ${fim}), 0) as outras`)
  return { moto: Number(r.moto), outras: Number(r.outras), total: Number(r.moto) + Number(r.outras) }
}
const OUTUBRO = ['2026-10-01T00:00:00Z', '2026-11-01T00:00:00Z'] as const

test('DRE do mês: taxa de cartão só do cartão e tarifa do Pix só do Pix', async () => {
  const a = await semearConta()
  await semearOutubro(a)
  const { colunas } = await dre.dreDoMes({ grupoId: a.grupoId, lojaIds: [a.lojaId], ano: 2026, mes: 10 })
  const e = colunas.find(c => c.chave === a.lojaId)!.entrada
  assert.equal(e.taxasCartao, 209)
  assert.equal(e.tarifaPix, 9)
})

test('as duas linhas somam a taxa de antes: a receita líquida não muda', async () => {
  const a = await semearConta()
  await semearOutubro(a)
  // Pix sem líquido: na moto conta inteiro (como no valor líquido), na peça conta zero (como na taxa de lá).
  await linhaConciliada(a, 'pix', 300, null, { venda: await vendaMoto(a, 300, '2026-10-20 12:00:00-03') })
  await linhaConciliada(a, 'pix', 50, null, { peca: await vendaPeca(a, 50, '2026-10-20 12:00:00-03') })
  await linhaConciliada(a, 'pix', 70, null, { os: await osConcluida(a, 70, '2026-10-20 12:00:00-03') })
  const { colunas } = await dre.dreDoMes({ grupoId: a.grupoId, lojaIds: [a.lojaId], ano: 2026, mes: 10 })
  const e = colunas.find(c => c.chave === a.lojaId)!.entrada
  assert.equal(e.tarifaPix, 9 + 300)
  assert.equal(e.taxasCartao + e.tarifaPix, (await taxaDeAntes([a.lojaId], ...OUTUBRO)).total)
})

test('DRE por mês: venda de 31/10 às 22h de Brasília cai em novembro na taxa e na tarifa', async () => {
  const a = await semearConta()
  const venda = await vendaMoto(a, 1_000, '2026-10-31 22:00:00-03')
  await linhaConciliada(a, 'credito', 600, 590, { venda })
  await linhaConciliada(a, 'pix', 400, 398, { venda })
  const meses = await dre.dreEvolucao({ grupoId: a.grupoId, lojaIds: [a.lojaId], ano: 2026, mes: 11, meses: 2 })
  const outubro = meses.find(m => m.mes === 10)!.entrada
  const novembro = meses.find(m => m.mes === 11)!.entrada
  assert.deepEqual([outubro.taxasCartao, outubro.tarifaPix], [0, 0])
  assert.deepEqual([novembro.taxasCartao, novembro.tarifaPix], [10, 2])
})

test('duas lojas da mesma Conta: cada uma com a sua tarifa', async () => {
  const a = await semearConta()
  const [outra] = await linhas(sql`insert into lojas (nome, cidade, endereco, grupo_id) values (${'TARPIX outra ' + randomUUID()}, 'C', 'R', ${a.grupoId}) returning id`)
  const b = { ...a, lojaId: outra.id as string }
  await linhaConciliada(a, 'pix', 1_000, 990, { peca: await vendaPeca(a, 1_000, '2026-10-10 12:00:00-03') })
  await linhaConciliada(b, 'pix', 2_000, 1_970, { peca: await vendaPeca(b, 2_000, '2026-10-10 12:00:00-03') })
  const { colunas } = await dre.dreDoMes({ grupoId: a.grupoId, lojaIds: [a.lojaId, b.lojaId], ano: 2026, mes: 10 })
  const tarifa = new Map(colunas.map(c => [c.chave, c.entrada.tarifaPix]))
  assert.equal(tarifa.get(a.lojaId), 10)
  assert.equal(tarifa.get(b.lojaId), 30)
})

test('Pix de outra Conta, não conciliado, de outro mês ou de OS não concluída não entra na tarifa', async () => {
  const a = await semearConta()
  const b = await semearConta()
  await semearOutubro(a)
  await linhaConciliada(b, 'pix', 7_000, 6_930, { venda: await vendaMoto(b, 7_000, '2026-10-15 12:00:00-03') })
  await linhaConciliada(a, 'pix', 1_000, 990, { peca: await vendaPeca(a, 1_000, '2026-10-18 12:00:00-03') }, false)
  await linhaConciliada(a, 'pix', 2_000, 1_950, { peca: await vendaPeca(a, 2_000, '2026-09-18 12:00:00-03') })
  const [aberta] = await linhas(sql`insert into ordens_servico (loja_id, aberta_por, descricao, status, valor_servicos)
    values (${a.lojaId}, ${a.usuarioId}, 'revisão', 'aberta', 500) returning id`)
  await linhaConciliada(a, 'pix', 500, 480, { os: aberta.id })
  const { colunas } = await dre.dreDoMes({ grupoId: a.grupoId, lojaIds: [a.lojaId], ano: 2026, mes: 10 })
  assert.equal(colunas.find(c => c.chave === a.lojaId)!.entrada.tarifaPix, 9)
})

test('DRE por mês: OS e peça também separam cartão e Pix', async () => {
  const a = await semearConta()
  await semearOutubro(a)
  const meses = await dre.dreEvolucao({ grupoId: a.grupoId, lojaIds: [a.lojaId], ano: 2026, mes: 10, meses: 1 })
  const outubro = meses.find(m => m.mes === 10)!.entrada
  assert.deepEqual([outubro.taxasCartao, outubro.tarifaPix], [209, 9])
})

test('Financeiro: taxas de OS e peça separadas no mesmo SELECT, soma igual à de antes, só nas lojas pedidas', async () => {
  const a = await semearConta()
  const b = await semearConta()
  await semearOutubro(a)
  await linhaConciliada(b, 'pix', 900, 880, { peca: await vendaPeca(b, 900, '2026-10-16 12:00:00-03') })
  const fimDeOutubro = new Date('2026-10-31T23:59:59.999Z')
  const r = await taxas.taxasOutrasDoPeriodo([a.lojaId], new Date(OUTUBRO[0]), fimDeOutubro)
  // peça: crédito 9 + Pix 1; OS: Pix 4
  assert.deepEqual(r, { taxaCartao: 9, tarifaPix: 5, custoPix: 0, qtdPix: 0 })
  assert.equal(r.taxaCartao + r.tarifaPix, (await taxaDeAntes([a.lojaId], ...OUTUBRO)).outras)
  assert.deepEqual(await taxas.taxasOutrasDoPeriodo([], new Date(OUTUBRO[0]), fimDeOutubro), { taxaCartao: 0, tarifaPix: 0, custoPix: 0, qtdPix: 0 })
})


// ─── #94: custo do PIX do banco de OS e peça (PIX vinculado e forçada), no Financeiro e no DRE ─────────────
const pixDoBanco = (grupoId: string, alvo: { os?: string; peca?: string; venda?: string }, bruto: number, custo: number) =>
  semearPixRecebido(db, grupoId, { valor: bruto - custo, vinculado: { ...alvo, valorBruto: bruto, custoPix: custo } })
const forcadaPix = (c: Conta, custo: number) => [{ tipo: 'pix', valor: 1_000, conciliadoManual: {
  motivo: 'Caiu na conta pessoal', porId: c.usuarioId, porNome: 'Aux', em: '2026-10-17T12:00:00.000Z',
  pix: { valorRecebido: 1_000 - custo, valorBruto: 1_000, custoPix: custo, custoPixTaxa: custo / 1_000 } } }]
const comPagamentos = (tabela: 'ordens_servico' | 'vendas_pecas', id: string, p: unknown) =>
  db.execute(sql`update ${sql.raw(tabela)} set pagamentos = ${JSON.stringify(p)}::jsonb where id = ${id}`)

// Outubro: OS com PIX do banco (custo 1,60) e forçada de PIX (custo 2,00); peça com PIX do banco (custo 0,40).
// Fora: OS de novembro, OS aberta, PIX de outra Conta apontando para a OS da A. Custo 4,00 em 3 PIX.
async function semearCustoPixOutubro(a: Conta, b: Conta) {
  const os = await osConcluida(a, 800, '2026-10-17 12:00:00-03')
  await pixDoBanco(a.grupoId, { os }, 800, 1.6)
  await comPagamentos('ordens_servico', os, forcadaPix(a, 2))
  await pixDoBanco(a.grupoId, { peca: await vendaPeca(a, 200, '2026-10-16 12:00:00-03') }, 200, 0.4)
  await pixDoBanco(a.grupoId, { os: await osConcluida(a, 500, '2026-11-02 12:00:00-03') }, 500, 1)
  const [aberta] = await linhas(sql`insert into ordens_servico (loja_id, aberta_por, descricao, status, valor_servicos)
    values (${a.lojaId}, ${a.usuarioId}, 'revisão', 'aberta', 300) returning id`)
  await pixDoBanco(a.grupoId, { os: aberta.id }, 300, 0.6)
  await pixDoBanco(b.grupoId, { os }, 900, 1.8)
}

test('Financeiro: custo do PIX de OS e peça do período (PIX do banco e forçada) e quantos PIX; fora o de outro mês, OS aberta e outra Conta', async () => {
  const a = await semearConta()
  const b = await semearConta()
  await semearCustoPixOutubro(a, b)
  const r = await taxas.taxasOutrasDoPeriodo([a.lojaId], new Date(OUTUBRO[0]), new Date('2026-10-31T23:59:59.999Z'))
  assert.deepEqual(r, { taxaCartao: 0, tarifaPix: 0, custoPix: 4, qtdPix: 3 })
  const deB = await taxas.taxasOutrasDoPeriodo([b.lojaId], new Date(OUTUBRO[0]), new Date('2026-10-31T23:59:59.999Z'))
  assert.deepEqual([deB.custoPix, deB.qtdPix], [0, 0])
})

test('DRE do mês e por mês: a linha do custo do PIX soma motos, OS e peças', async () => {
  const a = await semearConta()
  const b = await semearConta()
  await semearCustoPixOutubro(a, b)
  await pixDoBanco(a.grupoId, { venda: await vendaMoto(a, 3_000, '2026-10-15 12:00:00-03') }, 3_000, 6)
  const { colunas } = await dre.dreDoMes({ grupoId: a.grupoId, lojaIds: [a.lojaId], ano: 2026, mes: 10 })
  assert.equal(colunas.find(c => c.chave === a.lojaId)!.entrada.custoPix, 10)
  const meses = await dre.dreEvolucao({ grupoId: a.grupoId, lojaIds: [a.lojaId], ano: 2026, mes: 10, meses: 1 })
  assert.equal(meses.find(m => m.mes === 10)!.entrada.custoPix, 10)
})
