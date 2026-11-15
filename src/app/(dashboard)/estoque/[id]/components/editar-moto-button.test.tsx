// Editar moto (#941): o campo Status mostra as mesmas opções, na mesma ordem, e envia o mesmo
// valor depois da lista única de status.
import { createElement } from 'react'
import test, { after, afterEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import { montarDom } from '@/test/montar-dom'

const { dom, desmontar: desmontarDom } = montarDom()
const enviados: Record<string, unknown>[] = []
const mocks = [
  mock.module('../actions', {
    namedExports: { editarMotoAction: async (_id: string, dados: Record<string, unknown>) => { enviados.push(dados) } },
  }),
  mock.module('sonner', { namedExports: { toast: { success: () => {}, error: () => {} } } }),
]
after(() => { mocks.forEach(m => m.restore()); desmontarDom() })

const montados: (() => Promise<void>)[] = []
afterEach(async () => { for (const desmontar of montados.splice(0)) await desmontar() })

const MOTO = {
  id: 'moto-1', chassi: 'LXYTCK0000000013', cor: 'PRETO', motor: 'M1', modeloId: 'modelo-1', lojaId: 'loja-1',
  notaFiscalEntrada: '44080', disponibilidade: null,
}

async function montar(status: string) {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { EditarMotoButton } = await import('./editar-moto-button')
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(createElement(EditarMotoButton, {
      moto: { ...MOTO, status }, lojas: [{ id: 'loja-1', nome: 'Centro' }], modelos: [{ id: 'modelo-1', modelo: 'JET' }], temVenda: false,
    }))
  })
  montados.push(() => act(async () => { root.unmount(); container.remove() }))
  const disparar = (el: Element, tipo: string) => act(async () => {
    const Evento = tipo.startsWith('pointer') ? dom.window.PointerEvent ?? dom.window.MouseEvent : dom.window.MouseEvent
    el.dispatchEvent(new Evento(tipo, { bubbles: true, button: 0 } as MouseEventInit))
  })
  const clicar = async (el: Element) => { await disparar(el, 'pointerdown'); await disparar(el, 'mousedown'); await disparar(el, 'pointerup'); await disparar(el, 'mouseup'); await disparar(el, 'click') }
  const botao = (texto: string) => [...document.querySelectorAll('button')].find(b => b.textContent?.trim() === texto)!
  await clicar(botao('Editar'))
  // O select que fica no mesmo bloco do rótulo "Status".
  const gatilhoStatus = () => [...document.querySelectorAll('[role=dialog] label')]
    .find(l => l.textContent?.trim() === 'Status')?.parentElement?.querySelector('[role=combobox]')
  return { clicar, botao, gatilhoStatus }
}

// Um fluxo só: o select do base-ui aberto num teste não abre de novo no seguinte do mesmo arquivo.
test('Status: gatilho com o rótulo; opções Caixa, Montada e Garantia, nessa ordem; Montada envia "montada"', async () => {
  const t = await montar('em_garantia')
  // O gatilho traz a seta do select depois do texto.
  assert.equal(t.gatilhoStatus()?.textContent?.replace('▼', '').trim(), 'Garantia')
  await t.clicar(t.gatilhoStatus()!)
  const opcoes = [...document.querySelectorAll('[role=option]')]
  assert.deepEqual(opcoes.map(o => o.textContent?.trim()), ['Caixa', 'Montada', 'Garantia'])
  await t.clicar(opcoes.find(o => o.textContent?.trim() === 'Montada')!)
  await t.clicar(t.botao('Salvar'))
  assert.deepEqual(enviados.map(d => d.status), ['montada'])
})
