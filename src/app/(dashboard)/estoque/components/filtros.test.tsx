// Filtro de status do Showroom (#941): as opções, a ordem e o valor que vai para a URL não mudam
// com a lista única de status.
import { createElement } from 'react'
import test, { after, afterEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import { montarDom } from '@/test/montar-dom'

const { dom, desmontar: desmontarDom } = montarDom()
const urls: string[] = []
const mocks = [
  mock.module('next/navigation', {
    namedExports: {
      useRouter: () => ({ push: (url: string) => urls.push(url) }),
      usePathname: () => '/estoque',
      useSearchParams: () => new URLSearchParams(),
    },
  }),
]
after(() => { mocks.forEach(m => m.restore()); desmontarDom() })

const montados: (() => Promise<void>)[] = []
afterEach(async () => { for (const desmontar of montados.splice(0)) await desmontar() })

async function montar() {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { EstoqueFiltros } = await import('./filtros')
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(createElement(EstoqueFiltros, { lojas: [], modelos: [], cores: [], lojaIdDefault: null, chassiInicial: '' }))
  })
  montados.push(() => act(async () => { root.unmount(); container.remove() }))
  const botao = (texto: string) => [...container.querySelectorAll('button')].find(b => b.textContent === texto)!
  const clicar = (texto: string) => act(async () => {
    botao(texto).dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
  })
  // Opções do menu aberto ao lado do gatilho (mesmo bloco do filtro).
  const opcoesDe = (gatilho: string) =>
    [...botao(gatilho).parentElement!.querySelectorAll('button')].slice(1).map(b => b.textContent)
  return { clicar, opcoesDe }
}

test('filtro Status: opções Caixa, Montada e Garantia, nessa ordem', async () => {
  const { clicar, opcoesDe } = await montar()
  await clicar('Status')
  assert.deepEqual(opcoesDe('Status'), ['Caixa', 'Montada', 'Garantia'])
})

test('escolher Garantia leva status=em_garantia para a URL', async () => {
  urls.length = 0
  const { clicar } = await montar()
  await clicar('Status')
  await clicar('Garantia')
  assert.ok(urls.some(u => new URLSearchParams(u.split('?')[1]).get('status') === 'em_garantia'), urls.join(' | '))
})
