// Recibo dos itens do Efetivar (#25, V2): o que cada linha mostra, o selo por moto e o "Alterar" do valor da moto.
import { createElement, type ComponentProps } from 'react'
import test, { after, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { montarDom } from '@/test/montar-dom'
import { clicar, digitar } from '@/test/eventos-dom'

const { desmontar: desmontarDom } = montarDom()
after(desmontarDom)

const moto = (id: string, modelo: string, final: string, valor: string, minimo: number | null) =>
  ({ id, chassi: `9C2LA000000${final}`, marca: 'MC', modelo, cor: 'PRETA', lojaId: 'l1', lojaNome: 'Loja Centro', valor, minimo })
const JET = moto('m1', 'JET', '4131', '9490.00', 8990)
const PITICA = moto('m2', 'PITICA', '0088', '5200.00', 5490)
const PECAS = [
  { tipo: 'acessorio' as const, pecaId: 'c1', nome: 'Capacete fechado', quantidade: 2, valor: '145.00' },
  { tipo: 'brinde' as const, pecaId: 'b1', nome: 'Baú traseiro', quantidade: 1, valor: '0.00' },
]
const valores: [string, string][] = []

const montados: (() => Promise<void>)[] = []
afterEach(async () => { for (const d of montados.splice(0)) await d(); valores.length = 0 })

async function mostrar(props: Partial<ComponentProps<typeof import('./recibo-do-pedido').ReciboDoPedido>>) {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { ReciboDoPedido } = await import('./recibo-do-pedido')
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(createElement(ReciboDoPedido, {
      motos: [JET, PITICA], pecas: PECAS, selos: null, frete: 180, onValor: (id, v) => { valores.push([id, v]) },
      acaoDoFrete: createElement('button', { type: 'button' }, 'Mudar a entrega'), ...props,
    }))
  })
  montados.push(() => act(async () => { root.unmount(); container.remove() }))
  return container
}
const botoes = (c: HTMLElement) => [...c.querySelectorAll('button')]

test('motos, acessório, brinde e frete: cada linha com o detalhe e o valor; só moto tem "Alterar" do valor', async () => {
  const c = await mostrar({})
  const t = c.textContent ?? ''
  for (const linha of [/2 motos, 3 outros/, /MC JET/, /Chassi final 4131, preta\. Mínimo R\$\s*8\.990,00/, /R\$\s*9\.490,00/,
    /Capacete fechado/, /Acessório, 2 unidades/, /R\$\s*290,00/, /Baú traseiro/, /Brinde, sem cobrança/, /Frete/, /R\$\s*180,00/]) assert.match(t, linha)
  assert.deepEqual(botoes(c).map(b => b.getAttribute('aria-label') ?? b.textContent), ['Alterar valor da MC JET', 'Alterar valor da MC PITICA', 'Mudar a entrega'])
})

test('o selo aparece só quando vem: no mínimo e abaixo do mínimo, com o líquido', async () => {
  let c = await mostrar({})
  assert.doesNotMatch(c.textContent ?? '', /No mínimo|Abaixo do mínimo|líquido/)
  for (const d of montados.splice(0)) await d()
  c = await mostrar({ selos: [{ motoId: 'm1', minimo: 8990, liquido: 9086.61, abaixo: false }, { motoId: 'm2', minimo: 5490, liquido: 4978.97, abaixo: true }] })
  const [jet, pitica] = [...c.querySelectorAll('li')].map(li => li.textContent ?? '')
  assert.match(jet, /No mínimo.*líquido R\$\s*9\.086,61/)
  assert.match(pitica, /Abaixo do mínimo.*líquido R\$\s*4\.978,97/)
})

test('moto sem valor já abre o campo ("A definir"); "Alterar" abre o da outra; digitar avisa qual moto mudou', async () => {
  const c = await mostrar({ motos: [{ ...JET, valor: '' }, PITICA], pecas: [], frete: 0 })
  assert.match(c.textContent ?? '', /2 motos/)
  assert.doesNotMatch(c.textContent ?? '', /Frete|outros/)
  assert.match(c.textContent ?? '', /A definir/)
  assert.ok(c.querySelector('[aria-label="Valor da MC JET"]'), 'a moto sem valor abre o campo')
  assert.ok(!c.querySelector('[aria-label="Valor da MC PITICA"]'), 'a moto com valor só abre no "Alterar"')
  await clicar(c.querySelector('[aria-label="Alterar valor da MC PITICA"]'))
  await digitar(c.querySelector<HTMLInputElement>('[aria-label="Valor da MC PITICA"]')!, '510000')
  assert.deepEqual(valores.at(-1), ['m2', '5100.00'])
})

// Estados do Editar pedido efetivado (25d): com NF, sem "Alterar" para quem não muda valor, valor do acessório editável.
test('travado (NF valendo): moto e acessório mostram "Na nota" e nada se altera; o brinde só o valor', async () => {
  const c = await mostrar({ travado: true, onValorDaPeca: () => {} })
  const [jet, pitica, capacete, bau] = [...c.querySelectorAll('li')].map(li => li.textContent ?? '')
  for (const linha of [jet, pitica, capacete]) assert.match(linha, /Na nota/)
  assert.doesNotMatch(bau, /Na nota/)
  assert.deepEqual(botoes(c).map(b => b.textContent), ['Mudar a entrega'])
  assert.equal(c.querySelectorAll('input').length, 0)
})

test('quem não altera valor (aux_adm): os valores aparecem sem "Alterar"', async () => {
  const c = await mostrar({ podeAlterarValor: false, onValorDaPeca: () => {} })
  assert.match(c.textContent ?? '', /R\$\s*9\.490,00.*R\$\s*5\.200,00.*R\$\s*290,00/)
  assert.deepEqual(botoes(c).map(b => b.textContent), ['Mudar a entrega'])
})

test('com onValorDaPeca, o acessório tem "Alterar" do valor de cada unidade; o brinde não; digitar avisa qual peça mudou', async () => {
  const pecas: [string, string][] = []
  const c = await mostrar({ onValorDaPeca: (id, v) => { pecas.push([id, v]) } })
  assert.ok(c.querySelector('[aria-label="Alterar valor do Capacete fechado"]'))
  assert.ok(!c.querySelector('[aria-label="Alterar valor do Baú traseiro"]'))
  await clicar(c.querySelector('[aria-label="Alterar valor do Capacete fechado"]'))
  await digitar(c.querySelector<HTMLInputElement>('[aria-label="Valor de cada Capacete fechado"]')!, '12000')
  assert.deepEqual(pecas.at(-1), ['c1', '120.00'])
})
