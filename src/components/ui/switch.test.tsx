// Interruptor do design system. Prova: é um botão (role switch), mostra o valor pedido, desabilitado não responde
// ao clique, pode receber foco e fica na ordem de Tab. Não prova a troca por Espaço nem o tamanho da área de toque
// na tela: a classe da área ampliada no celular é conferida aqui; o tamanho real, só no navegador (Etapa 6).
import { createElement } from 'react'
import test, { after, afterEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import { montarDom } from '@/test/montar-dom'
import { clicar } from '@/test/eventos-dom'

const { desmontar: desmontarDom } = montarDom()
after(desmontarDom)

const montados: (() => Promise<void>)[] = []
afterEach(async () => { for (const d of montados.splice(0)) await d() })

async function montar(props: Record<string, unknown>) {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { Switch } = await import('./switch')
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => { root.render(createElement(Switch, props)) })
  let montado = true
  montados.push(() => act(async () => { if (!montado) return; montado = false; root.unmount(); container.remove() }))
  return document.querySelector<HTMLElement>('[role="switch"]')!
}

test('é um botão com role switch, e reflete o valor pedido', async () => {
  const el = await montar({ checked: true, onCheckedChange: () => {}, 'aria-label': 'Loja' })
  assert.equal(el.tagName, 'BUTTON')
  assert.equal(el.getAttribute('aria-checked'), 'true')
  assert.equal(el.getAttribute('aria-label'), 'Loja')
})

test('clique manda o novo valor ao pai', async () => {
  const mudou = mock.fn((_v: boolean) => {})
  const el = await montar({ checked: false, onCheckedChange: mudou, 'aria-label': 'Loja' })
  await clicar(el)
  assert.deepEqual(mudou.mock.calls.map(c => c.arguments[0]), [true])
})

test('desabilitado: não muda com o clique e fica com disabled', async () => {
  const mudou = mock.fn((_v: boolean) => {})
  const el = await montar({ checked: false, disabled: true, onCheckedChange: mudou, 'aria-label': 'Loja' })
  await clicar(el)
  assert.equal(mudou.mock.callCount(), 0)
  assert.equal((el as HTMLButtonElement).disabled, true)
})

test('pode receber foco e fica na ordem de Tab (a troca por Espaço não é coberta aqui)', async () => {
  const el = await montar({ checked: false, onCheckedChange: () => {}, 'aria-label': 'Loja' })
  assert.notEqual(el.getAttribute('tabindex'), '-1')
  el.focus()
  assert.equal(document.activeElement, el)
})

// A área de toque é o pseudo-elemento ancorado na área interna (dentro da borda de 1 px dos dois lados).
// Caixa de 32 x 18,4 px: área interna de 30 x 16,4 px. Para 44 px: 7 px de cada lado na largura, 14 na altura.
test('no celular, a área de toque chega a 44 px contando a borda de 1 px', async () => {
  const el = await montar({ checked: false, onCheckedChange: () => {}, 'aria-label': 'Loja' })
  const x = Number(el.className.match(/max-md:before:-inset-x-\[(\d+)px\]/)?.[1])
  const y = Number(el.className.match(/max-md:before:-inset-y-\[(\d+)px\]/)?.[1])
  assert.ok(el.className.includes(' border '), 'a borda de 1 px está no botão')
  assert.ok(30 + 2 * x >= 44, `largura: ${30 + 2 * x} px`)
  assert.ok(16.4 + 2 * y >= 44, `altura: ${16.4 + 2 * y} px`)
})
