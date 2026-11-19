// Faixa do Mercado Pago na /conciliacao (#51, PR6a, V2): o que ela mostra da última importação e o botão Importar
// (trava enquanto importa, recarrega no fim, mostra a recusa). A rede (fetch) e o roteador são a fronteira de fora.
import { test, after, afterEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import { montarDom } from '@/test/montar-dom'
import { botao, montarDialogo, textoDaTela } from '@/test/dialogo-em-tela'
import type { EstadoDaFaixaMp } from '@/lib/mercadopago/importar'

const { desmontar: desmontarDom } = montarDom()
after(desmontarDom)

const roteador = { refresh: mock.fn(), replace: mock.fn(), push: mock.fn() }
const mocks = [mock.module('next/navigation', { namedExports: { useRouter: () => roteador } })]
after(() => { for (const m of mocks) m.restore() })

const fetchOriginal = globalThis.fetch
const montados: (() => Promise<void>)[] = []
afterEach(async () => {
  globalThis.fetch = fetchOriginal
  roteador.refresh.mock.resetCalls()
  for (const d of montados.splice(0)) await d()
})

const ESTADO: EstadoDaFaixaMp = {
  ultimaImportacaoEm: '2026-11-19T12:02:00.000Z',
  resumo: {
    contagens: { conciliadas: 8, pendentes: 4, duplicadas: 3, estornos: 1, estornosSemLinha: 0, naoTratados: 1, ignorados: 5 },
    naoTratados: [{ motivo: 'cartão pré-pago', valor: 89.9, data: '2026-11-05', entraDepois: false }],
  },
  falha: null,
}

async function montar(estado: EstadoDaFaixaMp, podeImportar = true) {
  const { FaixaMercadoPago } = await import('./faixa-mercadopago')
  const t = await montarDialogo(FaixaMercadoPago, { estado, podeImportar })
  montados.push(t.desmontar)
  return t
}

test('mostra a hora, os 4 números, o não tratado com o Forçar e as 7 contagens em "Ver detalhes"', async () => {
  await montar(ESTADO)
  const texto = textoDaTela()
  assert.match(texto, /Importado em 19\/11 às 09:02/)
  // Rótulo antes do número no DOM (a ordem visual inverte com CSS).
  for (const pedaco of ['vendas novas8 já ligadas, 4 para vincular12', 'já estavam aqui3', 'não tratada1', 'estornada1']) assert.ok(texto.includes(pedaco), pedaco)
  assert.match(texto, /Cartão pré-pago de R\$\s89,90 em 05\/11\/2026: o MOVA não importa esse meio; concilie a venda com "Forçar"\./)
  assert.match(texto, /Fora da maquininha/)
})

test('nunca importado: diz isso e não mostra números; a falha da última rodada aparece como frase', async () => {
  await montar({ ultimaImportacaoEm: null, resumo: null, falha: { em: '2026-11-19T12:02:00.000Z', erro: 'O Mercado Pago recusou a credencial deste grupo (HTTP 401). Peça ao administrador para cadastrá-la de novo em Grupos.' } })
  assert.match(textoDaTela(), /Ainda não importado/)
  assert.doesNotMatch(textoDaTela(), /vendas novas/)
  assert.equal(document.querySelector('[role="alert"]')?.textContent ?? null,
    'A importação de 19/11 às 09:02 falhou: O Mercado Pago recusou a credencial deste grupo (HTTP 401). Peça ao administrador para cadastrá-la de novo em Grupos.')
})

test('Importar agora: um pedido só mesmo com dois cliques, botão travado enquanto importa e refresh no fim', async () => {
  const pedidos: string[] = []
  let responder: (r: Response) => void = () => {}
  globalThis.fetch = ((url: string) => { pedidos.push(url); return new Promise(r => { responder = r }) }) as typeof fetch
  const t = await montar(ESTADO)
  await t.clique('Importar agora')
  assert.equal(botao('Importando')?.disabled, true)
  await t.act(async () => { botao('Importando')!.click() })
  assert.deepEqual(pedidos, ['/api/conciliacao/mercadopago'])
  await t.act(async () => { responder({ json: async () => ({ ok: true }) } as Response) })
  assert.equal(roteador.refresh.mock.callCount(), 1)
  assert.equal(botao('Importar agora')?.disabled, false)
})

test('recusa da rota (sessão, permissão) aparece embaixo; sem permissão de gerir, o botão não aparece', async () => {
  globalThis.fetch = (async () => ({ json: async () => ({ error: 'Sem permissão' }) })) as unknown as typeof fetch
  const t = await montar(ESTADO)
  await t.clique('Importar agora')
  assert.equal(document.querySelector('[role="alert"]')?.textContent ?? null, 'Não deu para importar: Sem permissão')
  await t.desmontar()
  await montar(ESTADO, false)
  assert.equal(botao('Importar agora')?.outerHTML ?? null, null)
})
