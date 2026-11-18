// Card de taxas na Precificação (#683): recolhido no padrão à vista + 12x, sempre aberto no das taxas.
// Aba PIX (#89): custo do PIX com o exemplo calculado, e o que vai para a action ao salvar.
import { createElement } from 'react'
import test, { after, afterEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import { montarDom } from '@/test/montar-dom'
import { clicar, digitar } from '@/test/eventos-dom'
import type { TaxasPayload } from '../actions'

const { desmontar: desmontarDom } = montarDom()
after(desmontarDom)

const enviados: TaxasPayload[] = []
let resposta: { ok: true; dados: undefined } | { ok: false; erro: string } = { ok: true, dados: undefined }
const avisos: string[] = []
const mocks = [
  mock.module('../actions', { namedExports: { salvarTaxasAction: async (t: TaxasPayload) => { enviados.push(t); return resposta } } }),
  mock.module('sonner', { namedExports: { toast: { error: (m: string) => { avisos.push(m) }, success: () => {} } } }),
]
after(() => { for (const m of mocks) m.restore() })

const montados: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const desmontar of montados.splice(0)) await desmontar()
  enviados.length = 0
  avisos.length = 0
  resposta = { ok: true, dados: undefined }
})

const TAXAS = {
  taxasCartao: {}, taxasDebito: {}, taxasLink: {}, taxasFinanciamento: {},
  freteValorKm: '3.00', freteKmGratis: 40, freteValorFixo: '0.00', imposto: '0.06', custoPixTaxa: '0',
}
const botao = (texto: string) => [...document.querySelectorAll('button')].find(b => (b.textContent ?? '').trim() === texto)
const abertas = () => botao('Salvar taxas') !== undefined

async function montar(recolhida: boolean, taxas = TAXAS) {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { TaxasForm } = await import('./taxas-form')
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  const render = (r: boolean) => act(async () => { root.render(createElement(TaxasForm, { taxas, recolhida: r })) })
  await render(recolhida)
  let montado = true
  montados.push(() => act(async () => { if (!montado) return; montado = false; root.unmount(); container.remove() }))
  return { render }
}

test('no padrão à vista + 12x o card começa recolhido e abre em "Ver taxas"', async () => {
  await montar(true)
  assert.equal(abertas(), false)
  await clicar(botao('Ver taxas'))
  assert.equal(abertas(), true)
})

test('voltar ao padrão das taxas com a tela aberta deixa o card aberto', async () => {
  const t = await montar(true)
  assert.equal(abertas(), false)
  await t.render(false)
  assert.equal(abertas(), true)
  assert.equal(botao('Ver taxas'), undefined)
})

const abas = () => [...document.querySelectorAll('[role="tab"]')]
const campoCustoPix = () => {
  const rotulo = [...document.querySelectorAll('label')].find(l => l.textContent === 'Custo do PIX (%)')
  return document.getElementById(rotulo?.htmlFor ?? '') as HTMLInputElement | null
}
// Exemplo "Como fica um PIX de R$ 10.000,00": cada rótulo (dt) com o valor (dd) ao lado.
const exemplo = () => Object.fromEntries([...document.querySelectorAll('dt')]
  .map(dt => [dt.textContent, (dt.nextElementSibling?.textContent ?? '').replace(/\s/g, ' ')]))

test('a aba PIX vem antes de Cartão de Crédito e o quadro abre nela, com o custo salvo', async () => {
  await montar(false, { ...TAXAS, custoPixTaxa: '0.002000' })
  assert.deepEqual(abas().slice(0, 2).map(a => a.textContent), ['PIX', 'Cartão de Crédito (1–21x)'])
  assert.equal(abas()[0].getAttribute('aria-selected'), 'true')
  assert.equal(campoCustoPix()?.value, '0.2')
})

test('o exemplo de um PIX de R$ 10.000,00 recalcula ao digitar o custo', async () => {
  await montar(false)
  assert.deepEqual(exemplo(), { 'Valor do PIX': 'R$ 10.000,00', 'Custo do PIX': 'R$ 0,00', 'Entra na conta': 'R$ 10.000,00' })
  await digitar(campoCustoPix()!, '0.2')
  assert.deepEqual(exemplo(), { 'Valor do PIX': 'R$ 10.000,00', 'Custo do PIX': 'R$ 20,00', 'Entra na conta': 'R$ 9.980,00' })
})

test('salvar envia o custo do PIX em fração, junto com as outras taxas', async () => {
  await montar(false)
  await digitar(campoCustoPix()!, '0.2')
  await clicar(botao('Salvar taxas'))
  assert.equal(enviados.length, 1)
  assert.equal(enviados[0].custoPixTaxa, '0.002')
  assert.equal(enviados[0].imposto, '0.06')
})

test('a recusa da action aparece com a frase dela', async () => {
  resposta = { ok: false, erro: 'O custo do PIX precisa ser de 0 até menos de 100%' }
  await montar(false)
  await digitar(campoCustoPix()!, '100')
  await clicar(botao('Salvar taxas'))
  assert.deepEqual(avisos, ['O custo do PIX precisa ser de 0 até menos de 100%'])
})
