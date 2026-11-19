// Gaveta de baixo (#51, PR6-0): no arranjo das listas do celular (cartão guarda o id, a gaveta mostra o item com o
// título acessível), tocar no cartão abre com o título e o Esc fecha avisando quem usa.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { montarDom } from '@/test/montar-dom'
import { clicar, DEPOIS_DA_ANIMACAO_MS, esperar } from '@/test/dialogo-em-tela'

const { desmontar: desmontarDom } = montarDom()
after(desmontarDom)

test('tocar no cartão abre a gaveta com o título; Esc fecha', async () => {
  const { act, createElement, useState } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { SheetTitle } = await import('@/components/ui/sheet')
  const { GavetaDeBaixo } = await import('./gaveta-de-baixo')
  const fechamentos: boolean[] = []

  function Lista() {
    const [abertaId, setAbertaId] = useState<string | null>(null)
    return createElement('div', null,
      createElement('button', { type: 'button', onClick: () => setAbertaId('31902') }, 'Venda #31902'),
      createElement(GavetaDeBaixo, {
        aberta: abertaId !== null,
        onAbertaChange: (aberta: boolean) => { fechamentos.push(aberta); if (!aberta) setAbertaId(null) },
        children: abertaId && createElement(SheetTitle, null, `Venda #${abertaId}`),
      }))
  }

  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => { root.render(createElement(Lista)) })
  const conteudo = () => document.querySelector('[data-slot="sheet-content"]')
  assert.equal(conteudo()?.textContent ?? null, null)

  await act(async () => { clicar([...document.querySelectorAll('button')].find(b => b.textContent === 'Venda #31902')) })
  assert.equal(document.querySelector('[data-slot="sheet-title"]')?.textContent ?? null, 'Venda #31902')

  await act(async () => {
    conteudo()!.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await esperar(DEPOIS_DA_ANIMACAO_MS)
  })
  assert.deepEqual(fechamentos, [false])
  assert.equal(document.querySelector('[data-slot="sheet-title"]')?.textContent ?? null, null)
  await act(async () => { root.unmount() })
  container.remove()
})
