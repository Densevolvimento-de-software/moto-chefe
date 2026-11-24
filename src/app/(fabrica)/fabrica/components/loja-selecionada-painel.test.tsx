import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { montarDom } from '@/test/montar-dom'

const { desmontar } = montarDom()
after(desmontar)
type Tela = typeof import('./loja-selecionada-painel')
let LojaSelecionadaPainel: Tela['LojaSelecionadaPainel']
before(async () => { ({ LojaSelecionadaPainel } = await import('./loja-selecionada-painel')) })

const textoVisivel = (html: string) => html.replace(/<[^>]*>/g, ' ').replace(/ |&nbsp;/g, ' ').replace(/\s+/g, ' ')

test('loja selecionada: mostra o nome, o faturamento da loja e as motos vendidas, e só isso (sem estoque)', () => {
  const html = renderToStaticMarkup(createElement(LojaSelecionadaPainel, {
    loja: { lojaId: 'b', lojaNome: 'Loja Norte' }, faturamento: 40400.5, motos: 3,
  }))
  const texto = textoVisivel(html)
  assert.match(texto, /Loja Norte/)
  assert.match(texto, /Faturamento da loja R\$ 40\.400,50/)
  assert.match(texto, /Motos vendidas 3/)
  assert.doesNotMatch(texto, /estoque/i)
})
