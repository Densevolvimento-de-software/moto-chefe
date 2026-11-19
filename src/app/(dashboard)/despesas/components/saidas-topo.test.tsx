// Barra de /despesas (Saídas): o que a sincronização manda, o aviso de cada resposta, e o fim (tira o ?sync= da URL
// quando deu certo; senão refresh). A rede (fetch) e o roteador são a fronteira de fora (#51 PR6-0).
import { test, after, afterEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import { montarDom } from '@/test/montar-dom'
import { montarDialogo, textoDaTela } from '@/test/dialogo-em-tela'

// O motivo técnico da falha fica no title do aviso (tooltip).
const tituloDoAviso = () => document.querySelector('p[title]')?.getAttribute('title') ?? null

const { desmontar: desmontarDom } = montarDom()
after(desmontarDom)

const roteador = { refresh: mock.fn(), replace: mock.fn(), push: mock.fn() }
const mocks = [mock.module('next/navigation', { namedExports: {
  useRouter: () => roteador, usePathname: () => '/despesas', useSearchParams: () => new URLSearchParams(),
} })]
after(() => { for (const m of mocks) m.restore() })

const fetchOriginal = globalThis.fetch
const montados: (() => Promise<void>)[] = []
afterEach(async () => {
  globalThis.fetch = fetchOriginal
  for (const f of Object.values(roteador)) f.mock.resetCalls()
  for (const d of montados.splice(0)) await d()
})

function responder(corpo: unknown) {
  const corpos: unknown[] = []
  // Confere a rota: só a da sincronização desta tela responde.
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    assert.equal(url, '/api/despesas/sincronizar')
    corpos.push(JSON.parse(String(init.body)))
    return { json: async () => corpo }
  }) as unknown as typeof fetch
  return corpos
}

async function montar(o: { modoInicial: 'normal' | 'forcado' | 'completo'; sincronizarAoAbrir: boolean }) {
  const { SaidasTopo } = await import('./saidas-topo')
  const t = await montarDialogo(SaidasTopo, {
    itens: [{ rotulo: 'Saídas', valor: 'R$ 10,00', nota: '' }, { rotulo: 'Sem categoria', valor: '1', nota: '' }],
    from: '2026-11-01', to: '2026-11-19', hoje: '2026-11-19', rotuloSync: 'Atualizado agora', urlSemSync: '/despesas?aba=saidas', ...o,
  })
  montados.push(t.desmontar)
  await t.act(async () => { await new Promise(r => setTimeout(r, 20)) })
  return t
}

test('sync pedido na URL que dá certo: manda o modo e tira o ?sync= (replace), sem refresh', async () => {
  const corpos = responder({ ok: true, contasPuladas: [] })
  await montar({ modoInicial: 'completo', sincronizarAoAbrir: true })
  assert.deepEqual(corpos, [{ modo: 'completo' }])
  assert.deepEqual(roteador.replace.mock.calls.map(c => c.arguments[0]), ['/despesas?aba=saidas'])
  assert.equal(roteador.refresh.mock.callCount(), 0)
})

test('Atualizar agora força; falha, recusa e conta pulada avisam e dão refresh (a URL fica)', async () => {
  const t = await montar({ modoInicial: 'normal', sincronizarAoAbrir: false })
  for (const [corpo, frase, detalhe] of [
    [{ ok: false, erro: 'erro do servidor' }, /Não foi possível sincronizar agora/, 'erro do servidor'],
    [{ error: 'Sem permissão' }, /Não foi possível sincronizar agora/, 'Sem permissão'],
    [{ ok: true, contasPuladas: ['Banco Ficticio'] }, /O mcp.ai não respondeu para: Banco Ficticio/, null],
  ] as const) {
    const corpos = responder(corpo)
    await t.clique('Atualizar agora')
    assert.deepEqual(corpos, [{ modo: 'forcado' }])
    assert.match(textoDaTela(), frase)
    assert.equal(tituloDoAviso(), detalhe)
  }
  assert.equal(roteador.refresh.mock.callCount(), 3)
  assert.equal(roteador.replace.mock.callCount(), 0)
})

test('com ?sync= na URL e falha: refresh, a URL fica para o aviso continuar', async () => {
  responder({ ok: false, erro: 'erro' })
  await montar({ modoInicial: 'forcado', sincronizarAoAbrir: true })
  assert.equal(roteador.refresh.mock.callCount(), 1)
  assert.equal(roteador.replace.mock.callCount(), 0)
})
