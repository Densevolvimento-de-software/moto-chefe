// Simulador no padrão das taxas (#91): no card do PIX, o rodapé "Só para a loja" com o custo do PIX e o que
// entra na conta; sem custo no grupo, nada. Não muda preço, desconto nem o orçamento impresso do cliente.
// Frete (action) e janela de impressão são a fronteira de fora.
import { createElement } from 'react'
import test, { after, afterEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import { montarDom } from '@/test/montar-dom'
import { clicar } from '@/test/eventos-dom'
import { capturarImpressao } from '@/test/impressao-em-tela'

const { dom, desmontar: desmontarDom } = montarDom()
after(desmontarDom)

const acoesMock = mock.module('../actions', { namedExports: { simularFreteAction: async () => ({ ok: false, erro: 'sem frete' }) } })
after(() => acoesMock.restore())
const impressao = capturarImpressao(dom)

const montados: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const desmontar of montados.splice(0)) await desmontar()
})

const texto = (el: Element | null = document.body) => (el?.textContent ?? '').replace(/\s+/g, ' ')
const botao = (t: string) => [...document.querySelectorAll('button')].find(b => (b.textContent ?? '').trim() === t)
const RODAPE = 'Só para a loja, fora do orçamento do cliente'
const TAXAS = { taxasCartao: { '12': 0.08, '21': 0.12 }, taxasDebito: {}, taxasLink: {}, taxasFinanciamento: {} }

async function montar(custoPixTaxa: number) {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { ResultadoTaxas } = await import('./simulador-client')
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  const modelo = { id: 'm1', nome: 'Scooter 3000', valorMinimo: '10000.00', imagemUrl: null }
  await act(async () => {
    root.render(createElement(ResultadoTaxas, { modelo, taxas: { ...TAXAS, custoPixTaxa }, lojasFrete: [], isAdmin: false, lojaUsuarioId: null }))
  })
  let montado = true
  montados.push(() => act(async () => { if (!montado) return; montado = false; root.unmount(); container.remove() }))
  return { act }
}

// Os três cards de preço, sem o rodapé da loja: o que o cliente vê.
const precosDoCliente = () => {
  const grade = document.querySelector('[data-precos-destaque]')
  const copia = grade?.cloneNode(true) as Element | undefined
  copia?.querySelector('[aria-label="Só para a loja"]')?.remove()
  return texto(copia ?? null)
}

test('grupo com 0,20%: o card do PIX mostra o rodapé só para a loja, com custo e o que entra', async () => {
  await montar(0.002)
  const rodape = document.querySelector('[aria-label="Só para a loja"]')
  const linhas = [...(rodape?.querySelectorAll('p') ?? [])].map(p => {
    const partes = p.querySelectorAll('span')
    return partes.length ? [...partes].map(s => texto(s)).join(' ') : texto(p)
  })
  assert.deepEqual(linhas, [RODAPE, 'Custo do PIX R$ 20,00', 'Entra na conta no PIX R$ 9.980,00'])
})

test('grupo sem custo do PIX: sem rodapé', async () => {
  await montar(0)
  assert.equal(texto().includes(RODAPE), false)
})

test('o custo do PIX não muda os preços do cliente: 21x, 12x, valor promocional, desconto e economia', async () => {
  await montar(0)
  const semCusto = precosDoCliente()
  for (const d of montados.splice(0)) await d()
  await montar(0.002)
  assert.ok(semCusto.includes('Valor Promocional'), semCusto)
  assert.equal(precosDoCliente(), semCusto)
})

test('o orçamento impresso não leva o rodapé nem o custo do PIX', async () => {
  await montar(0.002)
  await clicar(botao('Imprimir / Salvar PDF'))
  assert.deepEqual(impressao.janelas, ['aberta'])
  const html = await impressao.papel()
  assert.match(html, /Scooter 3000/)
  assert.doesNotMatch(html, /Só para a loja|Custo do PIX|Entra na conta/)
})
