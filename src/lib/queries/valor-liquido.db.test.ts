// Teste de banco (#93): o líquido da venda de moto desconta o custo do PIX, nas duas formas da regra
// (valorLiquidoExpr, em Drizzle, e valorLiquidoSql, em SQL cru com alias), contra o Postgres descartável.
// Cada teste usa só as vendas que semeou.
import { before, after, mock, test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { eq, sql } from 'drizzle-orm'
import { semearContaBase, semearModelo, semearUsuario } from '@/test/semear-conta'
import { semearCustoPixDoGrupo, semearPixRecebido, semearVendaMoto, type Pagamentos } from '@/test/semear-alvos-conciliacao'
import { sessaoDe, type Sessao } from '@/test/sessao'

const url = process.env.TEST_DATABASE_URL
if (!url || !['localhost', '127.0.0.1'].includes(new URL(url).hostname)) throw new Error('Use somente Postgres descartável local')
process.env.DATABASE_URL = url

let db: typeof import('@/lib/db')['db']
let linhas: typeof import('@/lib/db')['execRows']
// Os Detalhes da venda leem os custos pela action de vendas: só a sessão e o que ela importa de fora são simulados.
let usuario: Sessao
const mocks = [
  mock.module('@/lib/auth', { namedExports: { getUsuarioLogado: async () => usuario } }),
  mock.module('next/cache', { namedExports: { revalidatePath: () => {} } }),
  mock.module('next/headers', { namedExports: { cookies: async () => ({ get: () => undefined }) } }),
  mock.module('@/lib/kommo', { namedExports: { virarLeadKommo: async () => ({ resultado: 'sem_lead' }) } }),
  mock.module('@/lib/whatsapp/venda', { namedExports: { notificarVendaWhatsapp: async () => ({ resultado: 'desligado' }) } }),
]
let acoesVendas: typeof import('@/app/(dashboard)/vendas/actions')
let vl: typeof import('@/lib/queries/valor-liquido')
let vendas: typeof import('@/lib/db/schema')['vendas']
let dre: typeof import('@/lib/queries/dre')
let contabil: typeof import('@/lib/queries/export-contabil')
let fechamento: typeof import('@/lib/queries/fechamento')
let dreLib: typeof import('@/lib/dre')
let dashboard: typeof import('@/lib/queries/dashboard')
let folha: typeof import('@/lib/queries/folha')
let vinculo: typeof import('@/lib/pix-vinculo')
let alvos: typeof import('@/lib/alvo-da-conciliacao')
let custoPix: typeof import('@/lib/custo-pix')

before(async () => {
  ;({ db, execRows: linhas } = await import('@/lib/db'))
  vl = await import('@/lib/queries/valor-liquido')
  ;({ vendas } = await import('@/lib/db/schema'))
  dre = await import('@/lib/queries/dre')
  contabil = await import('@/lib/queries/export-contabil')
  fechamento = await import('@/lib/queries/fechamento')
  dreLib = await import('@/lib/dre')
  dashboard = await import('@/lib/queries/dashboard')
  folha = await import('@/lib/queries/folha')
  vinculo = await import('@/lib/pix-vinculo')
  alvos = await import('@/lib/alvo-da-conciliacao')
  custoPix = await import('@/lib/custo-pix')
  acoesVendas = await import('@/app/(dashboard)/vendas/actions')
})
after(async () => {
  for (const m of mocks) m.restore()
  await (globalThis as { __pgPool?: { end(): Promise<void> } }).__pgPool?.end()
})


async function semearConta() {
  const suf = randomUUID()
  const base = await semearContaBase(db, { prefixo: 'LIQ93', nome: suf, cnpj: suf })
  const usuarioId = await semearUsuario(db, base, { papel: 'aux_adm' })
  return { ...base, usuarioId, modeloId: await semearModelo(db, `LIQ93 ${suf}`) }
}
type Conta = Awaited<ReturnType<typeof semearConta>>

async function vendaMoto(c: Conta, valor: number, pagamentos: Pagamentos = [], pedidoId?: string) {
  const venda = await semearVendaMoto(db, { lojaId: c.lojaId, usuarioId: c.usuarioId, modeloId: c.modeloId, em: '2026-11-10 12:00:00-03' },
    pagamentos, { valor, pedidoId })
  const pedido = (await linhas(sql`select pedido_venda_id as p from vendas where id = ${venda}`))[0].p as string
  return { venda, pedido }
}
async function cartaoConciliado(c: Conta, venda: string, bruto: number, liquido: number) {
  await db.execute(sql`insert into conciliacoes_cartao (grupo_id, operadora, data_transacao, nsu, valor_bruto, valor_liquido, tipo, venda_id, conciliado)
    values (${c.grupoId}, 'cielo', '2026-11-10', ${randomUUID()}, ${bruto}, ${liquido}, 'credito', ${venda}, true)`)
}
/** PIX recebido do banco já vinculado (o que o vínculo grava: crédito, valor do PIX, custo e taxa). */
const pixVinculado = (grupoId: string, alvo: { venda?: string; pedido?: string }, credito: number, bruto: number, custo: number, tipo = 'PIX') =>
  semearPixRecebido(db, grupoId, { valor: credito, tipoOperacao: tipo, vinculado: { ...alvo, valorBruto: bruto, custoPix: custo } })

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
  // Um PIX livre (sem vínculo) do grupo, uma TED vinculada e um PIX vinculado quando a taxa era 0: os dois com custo 0 gravado.
  await semearPixRecebido(db, c.grupoId, { valor: 4990 })
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

// Detalhes da venda (#93): os números vêm do servidor pelas mesmas contas do líquido e do DRE.
test('Detalhes da venda: taxa do cartão, tarifa do PIX na maquininha, custo do PIX e líquido; venda de outra Conta = vazio', async () => {
  const a = await semearConta()
  const { venda } = await vendaMoto(a, 18_500, [{ tipo: 'pix', valor: 10_000 }, { tipo: 'cartao_credito', valor: 8_500 }])
  await cartaoConciliado(a, venda, 8_500, 7_888)
  await pixVinculado(a.grupoId, { venda }, 9_980, 10_000, 20)
  usuario = sessaoDe(a, 'aux_adm', a.usuarioId)
  assert.deepEqual(await acoesVendas.custosDaVendaAction(venda), { ok: true, dados: { taxaCartao: 612, tarifaPix: 0, custoPix: 20, liquido: 17_868 } })
  const b = await semearConta()
  usuario = sessaoDe(b, 'aux_adm', b.usuarioId)
  assert.deepEqual(await acoesVendas.custosDaVendaAction(venda), { ok: true, dados: null })
  assert.deepEqual(await acoesVendas.custosDaVendaAction(randomUUID()), { ok: true, dados: null })
})

// C1 da revisão: o DRE resumido do fechamento tem o custo do PIX e a conta da tela fecha.
test('fechamento: o DRE resumido tem a linha do custo do PIX e bruta − deduções = líquida', async () => {
  const c = await semearConta()
  const { venda } = await vendaMoto(c, 18_500, [{ tipo: 'pix', valor: 10_000 }, { tipo: 'cartao_credito', valor: 8_500 }])
  await cartaoConciliado(c, venda, 8_500, 7_888)
  await pixVinculado(c.grupoId, { venda }, 9_980, 10_000, 20)
  const d = await fechamento.dadosFechamento({ grupoId: c.grupoId, lojaIds: [c.lojaId], ano: 2026, mes: 11 })
  const linhas = dreLib.dreResumido(d.dre)
  const v = (k: string) => linhas.find(l => l.chave === k)?.valor
  assert.deepEqual([v('taxas_cartao'), v('tarifa_pix'), v('custo_pix')], [612, 0, 20])
  const ateLiquida = linhas.slice(1, linhas.findIndex(l => l.chave === 'receita_liquida'))
  assert.equal(v('receita_bruta')! - ateLiquida.reduce((a, l) => a + l.valor, 0), v('receita_liquida'))
  assert.equal(v('receita_liquida'), 17_868)
})

// C3 (decisão do Luis registrada na #93; final com o Cesar na #191): a comissão não desconta o custo do PIX por ora.
// O painel do vendedor (a base do simulador de comissão) usa a mesma conta da folha: sem o custo do PIX.
test('painel do vendedor e folha: o líquido da comissão não desconta o custo do PIX; o do sócio desconta', async () => {
  const c = await semearConta()
  const { venda } = await vendaMoto(c, 18_500, [{ tipo: 'pix', valor: 10_000 }, { tipo: 'cartao_credito', valor: 8_500 }])
  await cartaoConciliado(c, venda, 8_500, 7_888)
  await pixVinculado(c.grupoId, { venda }, 9_980, 10_000, 20)
  const filtros = { dataInicio: '2026-11-01', dataFim: '2026-11-30', lojaId: [c.lojaId] }
  assert.equal((await dashboard.getKPIs(filtros, { useLiquidoValue: true })).faturamento, 17_888)
  assert.equal((await dashboard.getVendasPorDia(filtros, { useLiquidoValue: true })).reduce((a, d) => a + d.valor, 0), 17_888)
  assert.equal(await dashboard.getPrecoMedioVendas(filtros, { useLiquidoValue: true }), 17_888)
  // A folha: a base do vendedor e a da loja (aux_adm que ganha sobre a loja).
  const f = await folha.buscarDadosFolha({ mes: '2026-11', lojaIds: [c.lojaId], grupoId: c.grupoId })
  assert.deepEqual([f.vendasPorVendedor.map(v => Number(v.total)), f.motosPorLoja.map(v => Number(v.total))], [[17_888], [17_888]])
  const [comissao] = await db.select({ l: sql<string>`${vl.valorLiquidoDaComissaoExpr()}` }).from(vendas).where(eq(vendas.id, venda))
  assert.equal(Number(comissao.l), 17_888)
  assert.equal(await liquido(venda), 17_868)
})

// S1 (decisão do Luis registrada na #93): no painel do vendedor, ranking, modelos e últimas vendas usam a base da
// comissão (sem o custo do PIX), como o KPI e o simulador; para o sócio, o líquido real.
test('painel do vendedor: ranking, modelos e últimas vendas pela base da comissão; para o sócio, o líquido real', async () => {
  const c = await semearConta()
  const { venda } = await vendaMoto(c, 18_500, [{ tipo: 'pix', valor: 10_000 }, { tipo: 'cartao_credito', valor: 8_500 }])
  await cartaoConciliado(c, venda, 8_500, 7_888)
  await pixVinculado(c.grupoId, { venda }, 9_980, 10_000, 20)
  const filtros = { dataInicio: '2026-11-01', dataFim: '2026-11-30', lojaId: [c.lojaId] }
  const doVendedor = { baseDaComissao: true }
  const fat = (r: { faturamento: number | string }[]) => r.map(x => Number(x.faturamento))
  assert.deepEqual(fat(await dashboard.getRankingVendedores(filtros, doVendedor)), [17_888])
  assert.deepEqual(fat(await dashboard.getModelosMaisVendidos(filtros, doVendedor)), [17_888])
  assert.deepEqual((await dashboard.getUltimasVendas(filtros, 5, doVendedor)).map(v => Number(v.valor)), [17_888])
  assert.deepEqual(fat(await dashboard.getRankingVendedores(filtros)), [17_868])
  assert.deepEqual((await dashboard.getUltimasVendas(filtros)).map(v => Number(v.valor)), [17_868])
})

// Decisões 9 e 10 do Luis (#93): a forçada guarda o custo dela; da forçada só deixa de contar a parte que os PIX com
// custo ligados ao pedido cobrem (min(1, PIX do pedido / forçadas do pedido)). Desvincular o PIX devolve o custo.
const marcaPix = (c: Conta, base: number, custoPix: number) => ({ motivo: 'Caiu na conta pessoal', porId: c.usuarioId, porNome: 'Aux',
  em: '2026-11-10T12:00:00.000Z', pix: { valorRecebido: base - custoPix, valorBruto: base, custoPix, custoPixTaxa: custoPix / base } })

test('ordem direta: forçada de R$ 10.000 (custo 20), depois PIX de R$ 1.000 (custo 5) no pedido: conta 18 + 5; desvinculado, volta a 20', async () => {
  const c = await semearConta()
  const { venda, pedido } = await vendaMoto(c, 10_000, [{ tipo: 'pix', valor: 10_000, conciliadoManual: marcaPix(c, 10_000, 20) }])
  await semearCustoPixDoGrupo(db, c.grupoId, 0.005)
  const pix = await semearPixRecebido(db, c.grupoId, { valor: 995 })
  await vinculo.vincularPix(pix, c.grupoId, { tipo: 'pedido', pedidoId: pedido }, c.usuarioId)
  assert.equal(await liquido(venda), 10_000 - 5 - 18)
  await vinculo.desvincularPix(pix, c.grupoId)
  assert.equal(await liquido(venda), 10_000 - 20)
})

test('ordem inversa: PIX com custo no pedido cobrindo tudo, depois a forçada com custo: não conta; desvinculado, conta', async () => {
  const c = await semearConta()
  const { venda, pedido } = await vendaMoto(c, 1_000, [{ tipo: 'pix', valor: 1_000 }])
  const pix = await pixVinculado(c.grupoId, { pedido }, 2_994, 3_000, 6)
  await db.execute(sql`update vendas set pagamentos = ${JSON.stringify([{ tipo: 'pix', valor: 1_000, conciliadoManual: marcaPix(c, 1_000, 2) }])}::jsonb where id = ${venda}`)
  assert.equal(await liquido(venda), 1_000 - 6)
  await vinculo.desvincularPix(pix, c.grupoId)
  assert.equal(await liquido(venda), 1_000 - 2)
})

test('duas vendas do pedido dividem a fração: PIX de 5.000 no pedido, forçadas de 6.000 (custo 12) e 4.000 (custo 8) contam 6 e 4', async () => {
  const c = await semearConta()
  const primeira = await vendaMoto(c, 6_000, [{ tipo: 'pix', valor: 6_000, conciliadoManual: marcaPix(c, 6_000, 12) }])
  const segunda = await vendaMoto(c, 4_000, [{ tipo: 'pix', valor: 4_000, conciliadoManual: marcaPix(c, 4_000, 8) }], primeira.pedido)
  await pixVinculado(c.grupoId, { pedido: primeira.pedido }, 4_990, 5_000, 10)
  // O custo do PIX do pedido fica inteiro na 1ª venda (Q1).
  assert.deepEqual([await liquido(primeira.venda), await liquido(segunda.venda)], [6_000 - 10 - 6, 4_000 - 4])
})

test('Conta A × B: PIX da Conta A ligado ao pedido da B não cobre a forçada da B', async () => {
  const a = await semearConta()
  const b = await semearConta()
  const { venda, pedido } = await vendaMoto(b, 1_000, [{ tipo: 'pix', valor: 1_000, conciliadoManual: marcaPix(b, 1_000, 2) }])
  await pixVinculado(a.grupoId, { pedido }, 2_994, 3_000, 6)
  assert.equal(await liquido(venda), 1_000 - 2)
})

// Decisão 11 do Luis (#93): a tela recebe a cobertura do pedido (PIX com custo e forçadas das outras vendas) e soma as
// forçadas da própria venda; pela função pura, dá o mesmo custo que o SQL do líquido desconta.
test('cobertura da tela + função pura = o custo das forçadas que o líquido desconta, venda a venda', async () => {
  const c = await semearConta()
  const primeira = await vendaMoto(c, 6_000, [{ tipo: 'pix', valor: 6_000, conciliadoManual: marcaPix(c, 6_000, 12.37) }])
  const segunda = await vendaMoto(c, 4_000, [{ tipo: 'pix', valor: 4_000, conciliadoManual: marcaPix(c, 4_000, 8.11) }], primeira.pedido)
  await pixVinculado(c.grupoId, { pedido: primeira.pedido }, 2_994, 3_000, 6)
  for (const [venda, base, gravado, doPedido] of [[primeira.venda, 6_000, 12.37, 6], [segunda.venda, 4_000, 8.11, 0]] as const) {
    const cob = await alvos.coberturaDoPedidoDaVenda(venda)
    assert.ok(cob)
    const pgtos = [{ tipo: 'pix', valor: base, conciliadoManual: marcaPix(c, base, gravado) }]
    const { conta } = custoPix.custoDaForcadaQueConta(gravado, custoPix.coberturaComEstaVenda(cob, pgtos))
    assert.equal(Math.round((base - doPedido - conta) * 100), Math.round(await liquido(venda) * 100), venda)
  }
})

// C1 da revisão: forçada de custo 2,01 com metade coberta pelo PIX do pedido; o líquido conta 1,01, como a tela.
test('empate de meio centavo: o líquido conta 1,01 da forçada de 2,01 coberta pela metade, o mesmo da função pura', async () => {
  const c = await semearConta()
  const { venda, pedido } = await vendaMoto(c, 2_000, [{ tipo: 'pix', valor: 2_000, conciliadoManual: marcaPix(c, 2_000, 2.01) }])
  await pixVinculado(c.grupoId, { pedido }, 995, 1_000, 5)
  const { conta } = custoPix.custoDaForcadaQueConta(2.01, { pixDoPedido: 1_000, forcadasDoPedido: 2_000 })
  assert.equal(conta, 1.01)
  assert.equal(await liquido(venda), 2_000 - 5 - 1.01)
})

// T1 da revisão: TED (custo 0) ligada ao pedido não cobre a forçada; o custo dela conta inteiro.
test('TED ou PIX sem custo no pedido não cobre: a forçada conta o custo inteiro', async () => {
  const c = await semearConta()
  const { venda, pedido } = await vendaMoto(c, 1_000, [{ tipo: 'pix', valor: 1_000, conciliadoManual: marcaPix(c, 1_000, 2) }])
  await pixVinculado(c.grupoId, { pedido }, 3_000, 3_000, 0, 'TED')
  await pixVinculado(c.grupoId, { pedido }, 3_000, 3_000, 0)
  assert.equal(await liquido(venda), 1_000 - 2)
})
