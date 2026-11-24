import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  ehMarcaDoPainel, filtroDaUrl, urlDoFiltro, abaDaUrl, opcoesDoPainel, filtrarEstoque, filtrarVendas, resumirEstoque, resumirVendas,
  planilhaDoPainel, celulasDaVenda, nomeDaLoja, paraCsv, periodoDoPainel, finalDoChassi, lojasComVendas, lojasPorFaturamento, FILTRO_VAZIO, resumirRede, resumirModelos, lojaDaSelecao, blocosDaAba,
  type LinhaEstoquePainel, type LojaPainel, type VendaPainel,
} from './painel-fabrica'

test('marca: só MotoChefe, em qualquer grafia; Voi e vazio ficam de fora', () => {
  for (const m of ['MotoChefe', 'MOTOCHEFE', 'Moto Chefe', 'moto-chefe ']) assert.equal(ehMarcaDoPainel(m), true, m)
  for (const m of ['Voi', 'VOI', 'MotoChefe Voi', '', null, undefined]) assert.equal(ehMarcaDoPainel(m), false, String(m))
})

const estoque: LinhaEstoquePainel[] = [
  { lojaId: 'a', modelo: 'X12', cor: 'PRETO', quantidade: 3 },
  { lojaId: 'b', modelo: 'X12', cor: 'PRETO', quantidade: 2 },
  { lojaId: 'b', modelo: 'X12', cor: 'BRANCO', quantidade: 1 },
  { lojaId: 'a', modelo: 'JETMAX', cor: 'AZUL', quantidade: 4 },
]

test('estoque soma modelo × cor de todas as lojas e bate com o total', () => {
  const r = resumirEstoque(estoque)
  assert.deepEqual(r.modeloCor, [
    { modelo: 'JETMAX', cor: 'AZUL', quantidade: 4 },
    { modelo: 'X12', cor: 'BRANCO', quantidade: 1 },
    { modelo: 'X12', cor: 'PRETO', quantidade: 5 },
  ])
  assert.equal(r.total, 10)
  assert.equal(r.modeloCor.reduce((s, l) => s + l.quantidade, 0), r.total)
  assert.equal(r.porLoja.reduce((s, l) => s + l.quantidade, 0), r.total)
  // A soma não mexe na entrada (a tela refiltra a mesma lista).
  assert.equal(estoque[0].quantidade, 3)
})

test('filtro vazio é tudo; cada filtro restringe e eles se combinam', () => {
  assert.equal(filtrarEstoque(estoque, FILTRO_VAZIO).length, 4)
  assert.equal(filtrarEstoque(estoque, { ...FILTRO_VAZIO, lojas: ['b'] }).length, 2)
  assert.equal(filtrarEstoque(estoque, { ...FILTRO_VAZIO, cores: ['PRETO'] }).length, 2)
  assert.deepEqual(filtrarEstoque(estoque, { lojas: ['a'], modelos: ['X12'], cores: ['PRETO'] }), [estoque[0]])
})

const venda = (numero: number, lojaId: string, modelo: string, cor: string, data: string, valor = 10000): VendaPainel =>
  ({ numero, data, lojaId, modelo, cor, chassi: `CH${numero}`, valor })
const vendas: VendaPainel[] = [
  venda(101, 'a', 'X12', 'PRETO', '2026-10-02T15:00:00.000Z', 13490.1),
  venda(102, 'a', 'X12', 'BRANCO', '2026-10-20T15:00:00.000Z', 9990.2),
  venda(103, 'b', 'X12', 'PRETO', '2026-10-05T15:00:00.000Z', 16900),
  venda(104, 'b', 'JETMAX', 'AZUL', '2026-10-10T15:00:00.000Z', 12000),
  venda(105, 'b', 'JETMAX', 'AZUL', '2026-10-10T15:00:00.000Z', 11500.5),
]

test('vendas: a matriz loja × modelo sai da lista, uma moto por venda, e os totais fecham', () => {
  const r = resumirVendas(vendas)
  assert.equal(r.celula('b', 'JETMAX'), 2)
  assert.equal(r.celula('a', 'X12'), 2)
  assert.equal(r.celula('a', 'JETMAX'), 0)
  assert.deepEqual(r.modelos, ['JETMAX', 'X12'])
  assert.equal(r.porLoja.get('a'), 2)
  assert.equal(r.porLoja.get('b'), 3)
  assert.equal(r.porModelo.get('X12'), 3)
  assert.equal(r.porModelo.get('JETMAX'), 2)
  assert.equal(r.total, 5)
})

test('faturamento: total do período e por loja, somados no centavo', () => {
  const r = resumirVendas(vendas)
  // 13.490,10 + 9.990,20 = 23.480,30 (somado em ponto flutuante dá 23480.300000000003).
  assert.equal(r.valorPorLoja.get('a'), 23480.3)
  assert.equal(r.valorPorLoja.get('b'), 40400.5)
  assert.equal(r.valor, 63880.8)
})

test('faturamento: segue o filtro, porque soma só as vendas que chegam', () => {
  const r = resumirVendas(filtrarVendas(vendas, { lojas: [], modelos: ['JETMAX'], cores: [] }))
  assert.equal(r.valor, 23500.5)
  assert.equal(r.valorPorLoja.get('a'), undefined)
  assert.equal(resumirVendas([]).valor, 0)
})

// Loja Centro: 1 venda de R$ 20.000; Loja Norte: 2 de R$ 5.000; Loja Sul: nenhuma; Loja Oeste: 2 de R$ 4.000.
const lojasQuatro: LojaPainel[] = [
  { lojaId: 'c', lojaNome: 'Loja Sul' }, { lojaId: 'o', lojaNome: 'Loja Oeste' },
  { lojaId: 'n', lojaNome: 'Loja Norte' }, { lojaId: 'a', lojaNome: 'Loja Centro' },
]
const vendasQuatro = [
  venda(1, 'a', 'X12', 'PRETO', '2026-10-01T15:00:00.000Z', 20000),
  venda(2, 'n', 'X12', 'PRETO', '2026-10-01T15:00:00.000Z', 5000),
  venda(3, 'n', 'X12', 'PRETO', '2026-10-01T15:00:00.000Z', 5000),
  venda(4, 'o', 'X12', 'PRETO', '2026-10-01T15:00:00.000Z', 4000),
  venda(5, 'o', 'X12', 'PRETO', '2026-10-01T15:00:00.000Z', 4000),
]

test('lojas com venda: só as que venderam, com motos e faturamento, da que mais vendeu motos; empate pelo nome', () => {
  const l = lojasComVendas(lojasQuatro, resumirVendas(vendasQuatro))
  assert.deepEqual(l, [
    { lojaId: 'n', lojaNome: 'Loja Norte', motos: 2, valor: 10000 },
    { lojaId: 'o', lojaNome: 'Loja Oeste', motos: 2, valor: 8000 },
    { lojaId: 'a', lojaNome: 'Loja Centro', motos: 1, valor: 20000 },
  ])
})

test('lojas por faturamento: do maior valor para o menor, sem mexer na lista recebida', () => {
  const porMotos = lojasComVendas(lojasQuatro, resumirVendas(vendasQuatro))
  assert.deepEqual(lojasPorFaturamento(porMotos).map(l => l.lojaNome), ['Loja Centro', 'Loja Norte', 'Loja Oeste'])
  assert.deepEqual(porMotos.map(l => l.lojaNome), ['Loja Norte', 'Loja Oeste', 'Loja Centro'])
})

test('vendas: loja, modelo e cor filtram; da mais recente para a mais antiga, empate pelo número maior', () => {
  assert.deepEqual(filtrarVendas(vendas, FILTRO_VAZIO).map(v => v.numero), [102, 105, 104, 103, 101])
  assert.deepEqual(filtrarVendas(vendas, { ...FILTRO_VAZIO, cores: ['PRETO'] }).map(v => v.numero), [103, 101])
  assert.deepEqual(filtrarVendas(vendas, { lojas: ['b'], modelos: ['X12'], cores: [] }).map(v => v.numero), [103])
  assert.deepEqual(vendas.map(v => v.numero), [101, 102, 103, 104, 105], 'a ordem não mexe na entrada')
})

test('filtro e aba vão e voltam pela URL, com um ou vários valores', () => {
  assert.deepEqual(filtroDaUrl({}), FILTRO_VAZIO)
  assert.deepEqual(filtroDaUrl({ loja: 'a', modelo: ['X12', ' ', 'JETMAX'], cor: undefined }), { lojas: ['a'], modelos: ['X12', 'JETMAX'], cores: [] })
  const q = new URLSearchParams(urlDoFiltro({ lojas: ['a', 'b'], modelos: ['X 12'], cores: ['PRETO'] }, '2026-11-01', '2026-11-09', 'vendas'))
  assert.deepEqual(filtroDaUrl({ loja: q.getAll('loja'), modelo: q.getAll('modelo'), cor: q.getAll('cor') }), { lojas: ['a', 'b'], modelos: ['X 12'], cores: ['PRETO'] })
  assert.equal(q.get('de'), '2026-11-01')
  assert.equal(abaDaUrl(q.get('aba') ?? undefined), 'vendas')
})

test('aba: só "vendas" abre as vendas; qualquer outra coisa é o estoque', () => {
  assert.equal(abaDaUrl('vendas'), 'vendas')
  for (const v of ['estoque', undefined, '', 'VENDAS', ['vendas']]) assert.equal(abaDaUrl(v), 'estoque', String(v))
})

test('opções juntam modelos e cores do estoque e das vendas, sem repetir', () => {
  const o = opcoesDoPainel(estoque, [...vendas, venda(106, 'a', 'DRIFT', 'VERDE', '2026-10-01T15:00:00.000Z')])
  assert.deepEqual(o.modelos, ['DRIFT', 'JETMAX', 'X12'])
  assert.deepEqual(o.cores, ['AZUL', 'BRANCO', 'PRETO', 'VERDE'])
})

const lojas: LojaPainel[] = [{ lojaId: 'a', lojaNome: 'Loja Centro' }, { lojaId: 'b', lojaNome: 'Loja Norte' }]
const dadosPlanilha = { lojas, estoque, de: '2026-10-01', ate: '2026-10-31', hoje: '2026-11-14' }

test('Excel das vendas: data (dia de Brasília), número, loja, modelo, cor, chassi e o valor da moto como número, sem linha de total', () => {
  const tarde = venda(201, 'b', 'X12', 'PRETO', '2026-11-01T01:30:00.000Z', 9990) // 31/10 em Brasília; a hora não é real (#899)
  const p = planilhaDoPainel('vendas', { ...dadosPlanilha, vendas: [tarde, vendas[0]] })
  assert.equal(p.nome, 'vendas-motochefe-2026-10-01-a-2026-10-31.csv')
  assert.deepEqual(p.cabecalho, ['Data', 'Venda', 'Loja', 'Modelo', 'Cor', 'Chassi', 'Valor da moto'])
  assert.deepEqual(p.linhas, [
    ['31/10/2026', 201, 'Loja Norte', 'X12', 'PRETO', 'CH201', { reais: 9990 }],
    ['02/10/2026', 101, 'Loja Centro', 'X12', 'PRETO', 'CH101', { reais: 13490.1 }],
  ])
})

test('nome da loja pelo id; loja fora da lista fica em branco', () => {
  const nome = nomeDaLoja(lojas)
  assert.deepEqual(['b', 'a', 'x'].map(nome), ['Loja Norte', 'Loja Centro', ''])
})

test('a linha do Excel de vendas é a mesma das células da venda', () => {
  const p = planilhaDoPainel('vendas', { ...dadosPlanilha, vendas })
  assert.deepEqual(p.linhas, vendas.map(v => celulasDaVenda(v, nomeDaLoja(lojas))))
})

test('Excel do estoque: loja, modelo, cor e quantidade, sem cidade nem empresa', () => {
  const p = planilhaDoPainel('estoque', { ...dadosPlanilha, vendas })
  assert.equal(p.nome, 'estoque-motochefe-2026-11-14.csv')
  assert.deepEqual(p.cabecalho, ['Loja', 'Modelo', 'Cor', 'Quantidade'])
  assert.deepEqual(p.linhas, [
    ['Loja Centro', 'JETMAX', 'AZUL', 4],
    ['Loja Centro', 'X12', 'PRETO', 3],
    ['Loja Norte', 'X12', 'BRANCO', 1],
    ['Loja Norte', 'X12', 'PRETO', 2],
  ])
})

test('CSV abre no Excel pt-BR e não executa fórmula', () => {
  const csv = paraCsv(['Loja', 'Qtd'], [['Loja; Centro', 3], ['=HYPERLINK("x")', 1], ['Diz "oi"', 0]])
  assert.ok(csv.startsWith('﻿Loja;Qtd\r\n'))
  assert.ok(csv.includes('"Loja; Centro";3\r\n'))
  assert.ok(csv.includes(`"'=HYPERLINK(""x"")";1\r\n`))
  assert.ok(csv.includes('"Diz ""oi""";0\r\n'))
})

test('CSV: valor em reais sai como número com vírgula e sempre 2 casas, sem R$, que o Excel pt-BR lê como número', () => {
  const csv = paraCsv(['Venda', 'Valor da moto'], [[101, { reais: 13490.1 }], [102, { reais: 9990 }], [103, { reais: 0.05 }]])
  assert.ok(csv.includes('101;13490,10\r\n'), csv)
  assert.ok(csv.includes('102;9990,00\r\n'), csv)
  assert.ok(csv.includes('103;0,05\r\n'), csv)
})

test('final do chassi: os 4 últimos caracteres', () => {
  assert.equal(finalDoChassi('LA9EXEMPLO0000001'), '0001')
  assert.equal(finalDoChassi('AB1'), 'AB1')
})

// Teto de 92 dias da aba Vendas (#901). 14/11/2026 às 12h de Brasília.
const AGORA = new Date('2026-11-14T15:00:00.000Z')

test('período até 92 dias, contando o primeiro e o último dia, vem como pedido', () => {
  assert.deepEqual(periodoDoPainel({ de: '2026-08-15', ate: '2026-11-14' }, AGORA), { de: '2026-08-15', ate: '2026-11-14', limitado: false })
})

test('período de 93 dias ou mais: o início é cortado para os 92 dias que terminam no fim pedido', () => {
  assert.deepEqual(periodoDoPainel({ de: '2026-08-14', ate: '2026-11-14' }, AGORA), { de: '2026-08-15', ate: '2026-11-14', limitado: true })
  assert.deepEqual(periodoDoPainel({ de: '2020-01-01', ate: '2026-03-31' }, AGORA), { de: '2025-12-30', ate: '2026-03-31', limitado: true })
})

test('início depois do fim cai no mês corrente', () => {
  assert.deepEqual(periodoDoPainel({ de: '2026-10-20', ate: '2026-10-10' }, AGORA), { de: '2026-11-01', ate: '2026-11-14', limitado: false })
})

test('sem período, ou com data inválida, é o mês corrente de Brasília', () => {
  assert.deepEqual(periodoDoPainel({}, AGORA), { de: '2026-11-01', ate: '2026-11-14', limitado: false })
  assert.deepEqual(periodoDoPainel({ de: '2026-02-30' }, AGORA), { de: '2026-11-01', ate: '2026-11-14', limitado: false })
})

test('só o início muito antigo na URL: corta para 92 dias até hoje', () => {
  assert.deepEqual(periodoDoPainel({ de: '2025-01-01' }, AGORA), { de: '2026-08-15', ate: '2026-11-14', limitado: true })
})

test('rede: lojas com venda no filtro (não a lista toda); média = faturamento ÷ essas lojas', () => {
  const lojasRede: LojaPainel[] = [{ lojaId: 'a', lojaNome: 'A' }, { lojaId: 'b', lojaNome: 'B' }, { lojaId: 'c', lojaNome: 'C' }]
  const r = resumirRede(lojasRede, resumirVendas(vendas))
  assert.deepEqual(r, { lojasComVenda: 2, motos: 5, valor: 63880.8, mediaPorLoja: 31940.4 })
})

test('rede com filtro: uma loja e um modelo mostram só o que o filtro deixa, e a média divide pelas lojas com venda', () => {
  const lojasRede: LojaPainel[] = [{ lojaId: 'a', lojaNome: 'A' }, { lojaId: 'b', lojaNome: 'B' }, { lojaId: 'c', lojaNome: 'C' }]
  const daLoja = resumirRede(lojasRede, resumirVendas(filtrarVendas(vendas, { lojas: ['a'], modelos: [], cores: [] })))
  assert.deepEqual(daLoja, { lojasComVenda: 1, motos: 2, valor: 23480.3, mediaPorLoja: 23480.3 })
  const doModelo = resumirRede(lojasRede, resumirVendas(filtrarVendas(vendas, { lojas: [], modelos: ['JETMAX'], cores: [] })))
  assert.deepEqual(doModelo, { lojasComVenda: 1, motos: 2, valor: 23500.5, mediaPorLoja: 23500.5 })
})

test('rede com filtro sem venda: zero lojas com venda, média zero, sem divisão por zero', () => {
  const lojasRede: LojaPainel[] = [{ lojaId: 'a', lojaNome: 'A' }]
  const semVenda = resumirRede(lojasRede, resumirVendas(filtrarVendas(vendas, { lojas: [], modelos: ['NADA'], cores: [] })))
  assert.deepEqual(semVenda, { lojasComVenda: 0, motos: 0, valor: 0, mediaPorLoja: 0 })
})

test('rede: sem loja nem venda, tudo zero (sem divisão por zero)', () => {
  assert.deepEqual(resumirRede([], resumirVendas([])), { lojasComVenda: 0, motos: 0, valor: 0, mediaPorLoja: 0 })
})

const estoqueModelos: LinhaEstoquePainel[] = [
  { lojaId: 'a', modelo: 'X12', cor: 'PRETO', quantidade: 3 },
  { lojaId: 'b', modelo: 'X12', cor: 'BRANCO', quantidade: 1 },
  { lojaId: 'a', modelo: 'URBANA', cor: 'AZUL', quantidade: 2 },
]

test('modelos: vendidas, receita e preço médio (receita ÷ motos) batem com a lista; estoque por modelo, sem venda incluído', () => {
  assert.deepEqual(resumirModelos(vendas, estoqueModelos), [
    { modelo: 'JETMAX', vendidas: 2, receita: 23500.5, precoMedio: 11750.25, emEstoque: 0 },
    { modelo: 'URBANA', vendidas: 0, receita: 0, precoMedio: 0, emEstoque: 2 },
    { modelo: 'X12', vendidas: 3, receita: 40380.3, precoMedio: 13460.1, emEstoque: 4 },
  ])
})

test('modelos com filtro de modelo: só a linha do modelo escolhido, com os mesmos números', () => {
  const f = { lojas: [], modelos: ['JETMAX'], cores: [] }
  assert.deepEqual(resumirModelos(filtrarVendas(vendas, f), filtrarEstoque(estoqueModelos, f)), [
    { modelo: 'JETMAX', vendidas: 2, receita: 23500.5, precoMedio: 11750.25, emEstoque: 0 },
  ])
})

test('modelos sem venda no período: preço médio zero, sem NaN', () => {
  const r = resumirModelos([], estoqueModelos)
  assert.deepEqual(r.map(m => m.modelo), ['URBANA', 'X12'])
  assert.deepEqual(r.map(m => m.precoMedio), [0, 0])
  assert.deepEqual(r.map(m => m.emEstoque), [2, 4])
})

test('loja selecionada: só quando o filtro tem exatamente uma loja da lista; senão nenhuma', () => {
  const lojasDoPainel: LojaPainel[] = [{ lojaId: 'a', lojaNome: 'Loja Centro' }, { lojaId: 'b', lojaNome: 'Loja Norte' }]
  assert.deepEqual(lojaDaSelecao({ lojas: ['b'], modelos: [], cores: [] }, lojasDoPainel), { lojaId: 'b', lojaNome: 'Loja Norte' })
  assert.equal(lojaDaSelecao(FILTRO_VAZIO, lojasDoPainel), null)
  assert.equal(lojaDaSelecao({ lojas: ['a', 'b'], modelos: [], cores: [] }, lojasDoPainel), null)
  assert.equal(lojaDaSelecao({ lojas: ['zzz'], modelos: [], cores: [] }, lojasDoPainel), null)
})

test('blocos por aba: modelos nas duas abas; loja selecionada só na aba Vendas e só com uma loja no filtro', () => {
  const loja = { lojaId: 'b', lojaNome: 'Loja Norte' }
  assert.deepEqual(blocosDaAba('estoque', loja), { lojaSelecionada: false, modelos: true })
  assert.deepEqual(blocosDaAba('estoque', null), { lojaSelecionada: false, modelos: true })
  assert.deepEqual(blocosDaAba('vendas', loja), { lojaSelecionada: true, modelos: true })
  assert.deepEqual(blocosDaAba('vendas', null), { lojaSelecionada: false, modelos: true })
})
