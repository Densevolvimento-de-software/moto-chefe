import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { montarDom } from '@/test/montar-dom'
import type { RedePainel as Rede } from '@/lib/painel-fabrica'

const { desmontar } = montarDom()
after(desmontar)
type Tela = typeof import('./rede-painel')
let RedePainel: Tela['RedePainel']
before(async () => { ({ RedePainel } = await import('./rede-painel')) })

const rede: Rede = { lojas: 3, motos: 5, valor: 63880.8, valorPorLoja: 21293.6 }
/** Texto que a pessoa lê: sem as tags, espaço fixo vira espaço. */
const textoVisivel = (html: string) => html.replace(/<[^>]*>/g, ' ').replace(/\u00a0|&nbsp;/g, ' ').replace(/\s+/g, ' ')
const html = (r: Rede) => renderToStaticMarkup(createElement(RedePainel, { rede: r, periodo: '01/10/2026 a 31/10/2026' }))

test('rede: mostra o faturamento das motos (não "da rede" nem com meta), as motos, as lojas e a média por loja', () => {
  const texto = textoVisivel(html(rede))
  assert.match(texto, /Faturamento das motos R\$ 63\.880,80/)
  assert.match(texto, /5 motos vendidas/)
  assert.match(texto, /Lojas na rede 3/)
  assert.match(texto, /Faturamento médio por loja R\$ 21\.293,60/)
  assert.match(texto, /01\/10\/2026 a 31\/10\/2026/)
})

test('rede: nenhum bloco sem dado do painel (meta, projeção, oficina, DRE, ticket, estado, vendedor)', () => {
  const texto = textoVisivel(html(rede))
  for (const palavra of ['Meta', 'Projeção', 'Oficina', 'DRE', 'Ticket', 'Estado', 'Vendedor', 'Margem', 'NPS', 'Rentabilidade']) {
    assert.doesNotMatch(texto, new RegExp(palavra), palavra)
  }
  assert.doesNotMatch(texto, /—/, 'travessão')
})

test('rede: sem venda no período, mostra zero em vez de NaN ou traço', () => {
  const texto = textoVisivel(html({ lojas: 0, motos: 0, valor: 0, valorPorLoja: 0 }))
  assert.match(texto, /R\$ 0,00/)
  assert.match(texto, /0 motos vendidas/)
  assert.doesNotMatch(texto, /NaN/)
})
