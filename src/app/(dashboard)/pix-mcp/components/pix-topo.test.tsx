// Barra do /pix-mcp (#126, #51 PR6-0): o que a sincronização manda, o aviso de cada resposta e o refresh no fim.
// A rede (fetch) e o roteador são a fronteira de fora; o resto roda de verdade.
import { test, after, afterEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import { montarDom } from '@/test/montar-dom'
import { montarDialogo, textoDaTela } from '@/test/dialogo-em-tela'

const { desmontar: desmontarDom } = montarDom()
after(desmontarDom)

const roteador = { refresh: mock.fn(), replace: mock.fn(), push: mock.fn() }
const mocks = [mock.module('next/navigation', { namedExports: {
  useRouter: () => roteador, usePathname: () => '/pix-mcp', useSearchParams: () => new URLSearchParams(),
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
  globalThis.fetch = (async (_url: string, init: RequestInit) => { corpos.push(JSON.parse(String(init.body))); return { json: async () => corpo } }) as unknown as typeof fetch
  return corpos
}

async function montar(sincronizarAoAbrir: boolean) {
  const { PixTopo } = await import('./pix-topo')
  const t = await montarDialogo(PixTopo, {
    itens: [{ rotulo: 'Recebido', valor: 'R$ 10,00', nota: '' }, { rotulo: 'Sem vínculo', valor: '1', nota: '' }],
    from: '2026-11-01', to: '2026-11-19', hoje: '2026-11-19', min: '2026-09-15', rotuloSync: 'Atualizado agora', sincronizarAoAbrir,
  })
  montados.push(t.desmontar)
  await t.act(async () => { await new Promise(r => setTimeout(r, 20)) })
  return t
}

test('ao abrir sincroniza sem forçar e dá refresh, sem aviso', async () => {
  const corpos = responder({ ok: true, contasPuladas: [] })
  await montar(true)
  assert.deepEqual(corpos, [{ forcar: false }])
  assert.equal(roteador.refresh.mock.callCount(), 1)
  assert.doesNotMatch(textoDaTela(), /Não foi possível sincronizar/)
})

test('Atualizar agora força; falha do servidor, recusa da rota e conta pulada mostram o aviso de cada uma', async () => {
  const t = await montar(false)
  for (const [corpo, frase] of [
    [{ ok: false, erro: 'erro ao sincronizar' }, /Não foi possível sincronizar agora/],
    [{ error: 'Sem permissão' }, /Não foi possível sincronizar agora/],
    [{ ok: true, contasPuladas: ['Banco Ficticio'] }, /Conta não lida: Banco Ficticio/],
  ] as const) {
    const corpos = responder(corpo)
    await t.clique('Atualizar agora')
    assert.deepEqual(corpos, [{ forcar: true }])
    assert.match(textoDaTela(), frase)
  }
  assert.equal(roteador.refresh.mock.callCount(), 3)
})
