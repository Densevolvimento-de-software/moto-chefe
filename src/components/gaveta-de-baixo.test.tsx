// Gaveta de baixo (#51, PR6-0). O arranjo abaixo imita as listas do celular (cartão guarda o id e a gaveta mostra o
// item com o título acessível); não é a lista real de nenhuma tela. Tocar no cartão abre com o título e o Esc fecha
// avisando quem usa.
import { test, after, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { createElement, useState } from 'react'
import { montarDom } from '@/test/montar-dom'
import { DEPOIS_DA_ANIMACAO_MS, esperar, montarDialogo } from '@/test/dialogo-em-tela'

const { desmontar: desmontarDom } = montarDom()
after(desmontarDom)

const montados: (() => Promise<void>)[] = []
afterEach(async () => { for (const d of montados.splice(0)) await d() })

test('tocar no cartão abre a gaveta com o título; Esc fecha', async () => {
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

  const t = await montarDialogo(Lista, {})
  montados.push(t.desmontar)
  const titulo = () => document.querySelector('[data-slot="sheet-title"]')?.textContent ?? null
  assert.equal(titulo(), null)

  await t.clique('Venda #31902')
  assert.equal(titulo(), 'Venda #31902')

  await t.act(async () => {
    document.querySelector('[data-slot="sheet-content"]')!.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await esperar(DEPOIS_DA_ANIMACAO_MS)
  })
  assert.deepEqual(fechamentos, [false])
  assert.equal(titulo(), null)
})
