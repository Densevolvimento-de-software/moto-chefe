// Interruptor das telas de lojas e da chave: o "Salvando" fica numa região de status que já existe antes da gravação,
// para o leitor de tela anunciar a mudança do texto.
import { createElement } from 'react'
import test, { after, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { montarDom } from '@/test/montar-dom'

const { desmontar: desmontarDom } = montarDom()
after(desmontarDom)

const montados: (() => Promise<void>)[] = []
afterEach(async () => { for (const d of montados.splice(0)) await d() })

const PROPS = { checado: false, rotuloAcessivel: 'Loja MotoChefe: Centro', rotulos: { ligado: 'Marcada', desligado: 'Desmarcada' }, onMudar: () => {} }

async function montar(salvando: boolean) {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { Interruptor } = await import('./interruptor')
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  const desenhar = async (s: boolean) => { await act(async () => { root.render(createElement(Interruptor, { ...PROPS, salvando: s })) }) }
  await desenhar(salvando)
  let montado = true
  montados.push(() => act(async () => { if (!montado) return; montado = false; root.unmount(); container.remove() }))
  return { desenhar }
}

test('"Salvando" fica dentro de uma região de status, e a mesma região já existe antes da gravação', async () => {
  const { desenhar } = await montar(false)
  const regiao = document.querySelector('[role="status"]')
  assert.ok(regiao, 'a região existe com o interruptor parado')
  assert.equal(regiao.textContent, 'Desmarcada')
  await desenhar(true)
  assert.equal(document.querySelector('[role="status"]'), regiao, 'a região é a mesma depois de começar a gravar')
  assert.ok(regiao.textContent?.includes('Salvando'), 'o Salvando entra nessa região')
})
