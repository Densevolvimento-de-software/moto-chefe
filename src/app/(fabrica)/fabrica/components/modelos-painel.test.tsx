import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { montarDom } from '@/test/montar-dom'
import type { ModeloPainel } from '@/lib/painel-fabrica'

const { desmontar } = montarDom()
after(desmontar)
type Tela = typeof import('./modelos-painel')
let ModelosPainel: Tela['ModelosPainel']
before(async () => { ({ ModelosPainel } = await import('./modelos-painel')) })

const modelos: ModeloPainel[] = [
  { modelo: 'JETMAX', vendidas: 2, receita: 23500.5, precoMedio: 11750.25, emEstoque: 0 },
  { modelo: 'X12', vendidas: 3, receita: 40380.3, precoMedio: 13460.1, emEstoque: 4 },
]
const textoVisivel = (html: string) => html.replace(/<[^>]*>/g, ' ').replace(/ |&nbsp;/g, ' ').replace(/\s+/g, ' ')
const html = (m: ModeloPainel[]) => renderToStaticMarkup(createElement(ModelosPainel, { modelos: m, periodo: '01/11/2026 a 24/11/2026' }))

test('modelos: na tabela do computador, cada linha tem vendidas, receita, preço médio e estoque nessa ordem', () => {
  const tabela = html(modelos).match(/<table[\s\S]*?<\/table>/)?.[0] ?? ''
  assert.ok(tabela, 'a tabela do computador existe')
  const texto = textoVisivel(tabela)
  assert.match(texto, /JETMAX 2 R\$ 23\.500,50 R\$ 11\.750,25 0/)
  assert.match(texto, /X12 3 R\$ 40\.380,30 R\$ 13\.460,10 4/)
})

test('modelos: a seção tem o título "Vendas e estoque por modelo"', () => {
  assert.match(textoVisivel(html(modelos)), /Vendas e estoque por modelo/)
})

test('modelos: o subtítulo diz o período das vendas e que o estoque é de hoje', () => {
  assert.match(textoVisivel(html(modelos)), /Vendas de 01\/11\/2026 a 24\/11\/2026\. Estoque de hoje\./)
})

test('modelos: sem linha nenhuma, mostra o aviso e não NaN nem traço', () => {
  const texto = textoVisivel(html([]))
  assert.match(texto, /Nenhum modelo com venda ou estoque com estes filtros\./)
  assert.doesNotMatch(texto, /NaN/)
})

test('modelos: sem travessão no texto da tela', () => {
  assert.doesNotMatch(textoVisivel(html(modelos)), /—/)
})
