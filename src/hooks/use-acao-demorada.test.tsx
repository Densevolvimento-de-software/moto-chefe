// Hook da ação demorada (#51, PR6-0): o que ele manda e como devolve sucesso, recusa e falha de rede, e o
// pendente enquanto espera. A rede (fetch) é a fronteira de fora.
import { test, after, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { montarDom } from '@/test/montar-dom'

const { desmontar: desmontarDom } = montarDom()
after(desmontarDom)

const fetchOriginal = globalThis.fetch
const montados: (() => Promise<void>)[] = []
afterEach(async () => {
  globalThis.fetch = fetchOriginal
  for (const d of montados.splice(0)) await d()
})

type Corpo = { ok: boolean; total?: number }

async function montarHook() {
  const { act, createElement } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { useAcaoDemorada } = await import('./use-acao-demorada')
  const visto: { atual?: ReturnType<typeof useAcaoDemorada<Corpo>> } = {}
  function Sonda() { visto.atual = useAcaoDemorada<Corpo>('/api/alguma-rota'); return null }
  const container = document.createElement('div')
  const root = createRoot(container)
  await act(async () => { root.render(createElement(Sonda)) })
  montados.push(() => act(async () => root.unmount()))
  return { act, visto }
}

test('manda POST com o corpo em JSON e devolve o corpo da resposta; pendente só enquanto espera', async () => {
  const pedidos: { url: string; init: RequestInit }[] = []
  let responder: (r: Response) => void = () => {}
  globalThis.fetch = ((url: string, init: RequestInit) => { pedidos.push({ url, init }); return new Promise(r => { responder = r }) }) as typeof fetch
  const h = await montarHook()
  let resultado: unknown
  await h.act(async () => { void h.visto.atual!.disparar({ forcar: true }).then(r => { resultado = r }) })
  assert.equal(h.visto.atual!.pendente, true)
  await h.act(async () => { responder({ json: async () => ({ ok: true, total: 3 }) } as Response) })
  assert.deepEqual(resultado, { ok: true, dados: { ok: true, total: 3 } })
  assert.equal(h.visto.atual!.pendente, false)
  assert.deepEqual([pedidos[0].url, pedidos[0].init.method, pedidos[0].init.body], ['/api/alguma-rota', 'POST', '{"forcar":true}'])
})

test('recusa da rota ({ error }) e falha de rede voltam como frase, sem lançar', async () => {
  const h = await montarHook()
  globalThis.fetch = (async () => ({ json: async () => ({ error: 'Sem permissão' }) })) as unknown as typeof fetch
  let r: unknown
  await h.act(async () => { r = await h.visto.atual!.disparar({}) })
  assert.deepEqual(r, { ok: false, erro: 'Sem permissão' })
  globalThis.fetch = (async () => { throw new TypeError('fetch failed') }) as typeof fetch
  await h.act(async () => { r = await h.visto.atual!.disparar({}) })
  assert.deepEqual(r, { ok: false, erro: 'falha ao falar com o servidor' })
  assert.equal(h.visto.atual!.pendente, false)
})
