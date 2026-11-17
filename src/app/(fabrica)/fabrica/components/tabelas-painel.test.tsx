import { after, before, test, mock } from 'node:test'
import assert from 'node:assert/strict'
import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { COLUNAS_VENDAS, celulasDaVenda, nomeDaLoja, type LinhaEstoquePainel, type LojaPainel, type VendaPainel } from '@/lib/painel-fabrica'
import { montarDom } from '@/test/montar-dom'

const { desmontar } = montarDom()
after(desmontar)
const link = mock.module('next/link', { defaultExport: ({ href, children }: { href: string; children: ReactNode }) => createElement('a', { href }, children) })
after(() => link.restore())
type Tabelas = typeof import('./tabelas-painel')
let TabelaEstoque: Tabelas['TabelaEstoque']
let TabelaVendas: Tabelas['TabelaVendas']
before(async () => { ({ TabelaEstoque, TabelaVendas } = await import('./tabelas-painel')) })

const lojas: LojaPainel[] = [{ lojaId: 'loja-a', lojaNome: 'Loja Centro' }, { lojaId: 'loja-b', lojaNome: 'Loja Norte' }]
const vendas: VendaPainel[] = [
  { numero: 201, data: '2026-11-01T01:30:00.000Z', lojaId: 'loja-b', modelo: 'X12', cor: 'PRETO', chassi: 'LA9EXEMPLO0000201', valor: 13490.5 },
  { numero: 101, data: '2026-10-02T15:00:00.000Z', lojaId: 'loja-a', modelo: 'JETMAX', cor: 'AZUL', chassi: 'LA9EXEMPLO0000101', valor: 9990 },
]
const estoque: LinhaEstoquePainel[] = [
  { lojaId: 'loja-a', modelo: 'X12', cor: 'PRETO', quantidade: 3 },
  { lojaId: 'loja-b', modelo: 'X12', cor: 'BRANCO', quantidade: 1 },
]
const filtro = { lojas: [], modelos: [], cores: [] }
const props = { lojas, periodo: '01/10/2026 a 31/10/2026', filtro, de: '2026-10-01', ate: '2026-10-31' }
const TRAVESSAO = '—'

/** Texto que a pessoa lê: o HTML sem as tags (o id da loja pode estar só no href); o espaço fixo do R$ vira espaço. */
const textoVisivel = (html: string) => html.replace(/<[^>]*>/g, ' ').replace(/\u00a0|&nbsp;/g, ' ')
/** Textos das células de cada linha (`<tr>`) da tabela, sem as tags. */
const linhas = (html: string) =>
  [...html.matchAll(/<tr[^>]*>(.*?)<\/tr>/g)].map(tr => [...tr[1].matchAll(/<t[dh][^>]*>(.*?)<\/t[dh]>/g)].map(c => textoVisivel(c[1]).trim()))
const linhaQueComecaCom = (html: string, inicio: string) => linhas(html).find(l => l[0] === inicio)

test('vendas: cada venda numa linha com a data (dia de Brasília, sem hora), número, loja, modelo, cor e chassi', () => {
  const html = renderToStaticMarkup(createElement(TabelaVendas, { ...props, vendas }))
  // 01:30 UTC de 01/11 ainda é 31/10 em Brasília. Sem hora: a data da venda é digitada sem hora.
  assert.deepEqual(linhaQueComecaCom(html, '31/10/2026'), ['31/10/2026', '201', 'Loja Norte', 'X12', 'PRETO', 'LA9EXEMPLO0000201', 'R$ 13.490,50'])
  assert.deepEqual(linhaQueComecaCom(html, '02/10/2026'), ['02/10/2026', '101', 'Loja Centro', 'JETMAX', 'AZUL', 'LA9EXEMPLO0000101', 'R$ 9.990,00'])
})

test('vendas: a lista tem as colunas da planilha, na mesma ordem', () => {
  const html = renderToStaticMarkup(createElement(TabelaVendas, { ...props, vendas }))
  assert.ok(linhas(html).some(l => l.join('|') === COLUNAS_VENDAS.join('|')))
})

test('vendas: a linha da tela tem as mesmas células da planilha; o valor, em reais', () => {
  const html = renderToStaticMarkup(createElement(TabelaVendas, { ...props, vendas }))
  for (const v of vendas) {
    const celulas = celulasDaVenda(v, nomeDaLoja(lojas))
    const linha = linhaQueComecaCom(html, String(celulas[0]))
    assert.deepEqual(linha?.slice(0, -1), celulas.slice(0, -1).map(String))
    assert.deepEqual(celulas.at(-1), { reais: v.valor })
  }
})

test('vendas: a loja leva ao filtro só dela, na aba de vendas, mantendo modelo, cor e período', () => {
  const html = renderToStaticMarkup(createElement(TabelaVendas, { ...props, vendas, filtro: { lojas: ['loja-a'], modelos: ['X12'], cores: ['PRETO'] } }))
  assert.ok(html.includes('href="/fabrica?aba=vendas&amp;de=2026-10-01&amp;ate=2026-10-31&amp;loja=loja-b&amp;modelo=X12&amp;cor=PRETO"'))
})

test('vendas: no impresso a loja não vira link', () => {
  const html = renderToStaticMarkup(createElement(TabelaVendas, { ...props, vendas, impresso: true }))
  assert.ok(!html.includes('<a '))
})

test('vendas: célula zerada da matriz mostra 0, sem travessão', () => {
  const html = renderToStaticMarkup(createElement(TabelaVendas, { ...props, vendas }))
  assert.ok(!html.includes(TRAVESSAO))
  // Colunas da matriz: JETMAX, X12, Total. Loja Centro vendeu 1 JETMAX e nenhuma X12.
  const matriz = linhas(html).filter(l => l.length === 4)
  assert.deepEqual(matriz.find(l => l[0] === 'Loja Centro'), ['Loja Centro', '1', '0', '1'])
  assert.deepEqual(matriz.find(l => l[0] === 'Loja Norte'), ['Loja Norte', '0', '1', '1'])
})

test('vazio: nem vendas nem estoque mostram travessão', () => {
  const html = renderToStaticMarkup(createElement(TabelaVendas, { ...props, vendas: [] }))
    + renderToStaticMarkup(createElement(TabelaEstoque, { lojas, estoque: [] }))
  assert.ok(!html.includes(TRAVESSAO))
  assert.ok(html.includes('Nenhuma venda no período com estes filtros.'))
  assert.ok(html.includes('Nenhuma loja com estoque com estes filtros.'))
})

test('estoque: a tabela por loja mostra só o nome da loja e a quantidade', () => {
  const html = renderToStaticMarkup(createElement(TabelaEstoque, { lojas, estoque }))
  assert.deepEqual(linhaQueComecaCom(html, 'Loja Centro'), ['Loja Centro', '3'])
  assert.deepEqual(linhaQueComecaCom(html, 'Loja Norte'), ['Loja Norte', '1'])
})

test('o id da loja não aparece como texto em nenhuma tabela', () => {
  const texto = textoVisivel(renderToStaticMarkup(createElement(TabelaVendas, { ...props, vendas }))
    + renderToStaticMarkup(createElement(TabelaEstoque, { lojas, estoque })))
  assert.ok(!texto.includes('loja-a'))
  assert.ok(!texto.includes('loja-b'))
})

// ─── Valor e faturamento (#30) ────────────────────────────────────────────────
/** Monta o HTML no documento do montarDom, para ler por seletor. */
const montar = (el: ReturnType<typeof createElement>) => {
  document.body.innerHTML = renderToStaticMarkup(el)
  return document.body
}
const texto = (el: Element | null | undefined) => textoVisivel(el?.innerHTML ?? '').replace(/\s+/g, ' ').trim()
const porRotulo = (raiz: Element, rotulo: string) => raiz.querySelector(`[aria-label="${rotulo}"]`)
const telaVendas = (extra: Partial<Parameters<typeof TabelaVendas>[0]> = {}) => montar(createElement(TabelaVendas, { ...props, vendas, ...extra }))

test('faixa: faturamento do período, motos e lojas, e que é o valor da moto sem frete nem acessório', () => {
  const faixa = porRotulo(telaVendas(), 'Faturamento no período')
  assert.ok(faixa, 'faixa de faturamento')
  const t = texto(faixa)
  assert.ok(t.includes('R$ 23.480,50'), t)
  assert.ok(t.includes('2 motos em 2 lojas'), t)
  assert.ok(t.includes('Valor da moto, sem frete nem acessório'), t)
})

test('faixa: "Ver por loja" recolhido mostra cada loja com o faturamento e as motos, do maior para o menor', () => {
  const porLoja = telaVendas().querySelector('details[aria-label="Faturamento por loja"]')
  assert.ok(porLoja, 'recolhível do por loja')
  assert.equal(porLoja.hasAttribute('open'), false, 'nasce recolhido')
  assert.ok(texto(porLoja.querySelector('summary')).includes('Ver por loja'))
  const linhasLoja = [...porLoja.querySelectorAll('li')].map(texto)
  assert.deepEqual(linhasLoja, ['Loja Norte R$ 13.490,50 1 moto', 'Loja Centro R$ 9.990,00 1 moto'])
})

// O jsdom não aplica media query: o que cada largura mostra de fato se confere no navegador (Etapa 6).
test('marcação por largura: o "Ver por loja" e as tabelas de vendas por loja levam as classes que os escondem abaixo de md', () => {
  const tela = telaVendas()
  assert.ok(porRotulo(tela, 'Faturamento por loja')?.classList.contains('md:block'))
  assert.ok(porRotulo(tela, 'Faturamento por loja')?.classList.contains('hidden'))
  const tabelas = porRotulo(tela, 'Tabelas de vendas por loja')
  assert.ok(tabelas?.classList.contains('hidden') && tabelas.classList.contains('md:grid'))
})

test('detalhe: coluna "Valor da moto" e rodapé com o total de motos e de valor', () => {
  const tabela = porRotulo(telaVendas(), 'Detalhes das vendas')
  assert.ok(tabela, 'tabela do detalhe')
  assert.ok(texto(tabela.querySelector('thead')).endsWith('Valor da moto'))
  assert.equal(texto(tabela.querySelector('tfoot')), 'Total, 2 motos R$ 23.480,50')
})

test('celular, loja × modelo: uma linha por loja com as motos; o toque abre o faturamento e cada modelo, zero incluído', () => {
  const lista = porRotulo(telaVendas(), 'Vendas por loja e modelo')
  assert.ok(lista, 'lista do celular')
  assert.ok(lista.classList.contains('md:hidden'), 'só no celular')
  const centro = [...lista.querySelectorAll('details')].find(d => texto(d.querySelector('summary')).startsWith('Loja Centro'))
  assert.ok(centro)
  assert.equal(texto(centro.querySelector('summary')), 'Loja Centro 1 moto')
  assert.deepEqual([...centro.querySelectorAll('dl > div')].map(texto), ['Faturamento R$ 9.990,00', 'JETMAX 1', 'X12 0'])
  assert.equal(texto(lista.lastElementChild), 'Total 2 motos')
})

test('celular, detalhe: duas linhas por venda (modelo e valor; dia, loja, cor e final do chassi); o toque abre data, venda, loja e chassi', () => {
  const lista = porRotulo(telaVendas(), 'Vendas, uma por linha')
  assert.ok(lista, 'lista do celular')
  assert.ok(lista.classList.contains('md:hidden'), 'só no celular')
  const [primeira] = lista.querySelectorAll('details')
  // 01:30 UTC de 01/11 ainda é 31/10 em Brasília.
  assert.equal(texto(primeira.querySelector('summary')), 'X12 R$ 13.490,50 31/10 · Loja Norte · PRETO · final 0201')
  assert.deepEqual([...primeira.querySelectorAll('dl > div')].map(texto), ['Data 31/10/2026', 'Venda 201', 'Loja Loja Norte', 'Chassi LA9EXEMPLO0000201'])
  assert.equal(texto(lista.lastElementChild), 'Total, 2 motos R$ 23.480,50 Valor da moto, sem frete nem acessório')
})

test('impresso: o faturamento por loja sai aberto, sem botão de recolher, e as listas do celular não saem no papel', () => {
  const tela = montar(createElement(TabelaVendas, { ...props, vendas, impresso: true }))
  assert.equal(porRotulo(tela, 'Faturamento no período')?.querySelector('summary'), null)
  const porLoja = porRotulo(tela, 'Faturamento por loja')
  assert.ok(porLoja && !porLoja.classList.contains('hidden'))
  assert.equal(porLoja.querySelectorAll('li').length, 2)
  for (const rotulo of ['Vendas por loja e modelo', 'Vendas, uma por linha']) {
    assert.ok(porRotulo(tela, rotulo)?.classList.contains('print:hidden'), rotulo)
  }
  assert.ok(porRotulo(tela, 'Tabelas de vendas por loja')?.classList.contains('print:grid'))
  assert.ok(porRotulo(tela, 'Detalhes das vendas')?.parentElement?.classList.contains('print:block'))
})

test('sem vendas: faturamento R$ 0,00 e a frase de vazio, sem travessão', () => {
  const tela = telaVendas({ vendas: [] })
  assert.ok(texto(porRotulo(tela, 'Faturamento no período')).includes('R$ 0,00'))
  assert.equal(porRotulo(tela, 'Faturamento por loja'), null)
  assert.ok(!texto(tela).includes(TRAVESSAO))
  assert.ok(texto(porRotulo(tela, 'Vendas, uma por linha')).includes('Nenhuma venda no período com estes filtros.'))
})
