// Card do pedido (#776): pedido em aprovação mostra "Aguardando aprovação" e esconde Efetivar e Cancelar,
// que o servidor também recusa enquanto a aprovação não sai.
import { createElement } from 'react'
import test, { after, afterEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import type { PedidoComDetalhes } from '@/lib/queries/vendas'
import { montarDom } from '@/test/montar-dom'

const { dom, desmontar } = montarDom()
after(desmontar)
// O botão "Editar pedido" (#25) traz o diálogo do Novo pedido, que escolhe o layout por matchMedia; o JSDOM não tem.
;(dom.window as unknown as { matchMedia: unknown }).matchMedia = () => ({ matches: true, addEventListener: () => {}, removeEventListener: () => {} })

mock.module('../actions', { namedExports: {
  cancelarPedidoAction: async () => ({ ok: true }), efetivarVendaAction: async () => ({ ok: true }), buscarPrecoMinimoAction: async () => null,
} })
mock.module('@/app/(dashboard)/clientes/actions', { namedExports: {
  buscarClientesAction: async () => [], criarClienteAction: async () => ({ ok: true, dados: undefined }),
} })

const PEDIDO = {
  id: 'p1', numero: 77, status: 'pendente', motoId: 'm1', lojaId: 'loja-1', vendedorId: 'v1', chassi: 'CHASSI1', cor: 'CINZA',
  marca: 'MOTOCHEFE', modelo: 'JET', lojaNome: 'Loja Exemplo', vendedorNome: 'Vendedor Exemplo', observacao: null,
  dataPedido: new Date('2026-11-14T12:00:00Z'), entrega: null, emAprovacao: false,
  motos: [{ id: 'm1', marca: 'MOTOCHEFE', modelo: 'JET', chassi: 'CHASSI1', cor: 'CINZA', valor: '9490.00' }],
} as unknown as PedidoComDetalhes

let desmontarCard: (() => Promise<void>) | null = null
afterEach(async () => { await desmontarCard?.(); desmontarCard = null; document.body.innerHTML = '' })

async function desenhar(pedido: PedidoComDetalhes, papel = 'aux_adm') {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { PedidoCard } = await import('./pedido-card')
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(createElement(PedidoCard, { pedido, papel, usuarioId: 'u1', lojaIdUsuario: 'loja-1', origens: [], podeAprovarSensivel: false, motosDisponiveis: [] } as never))
  })
  desmontarCard = () => act(async () => { root.unmount() })
}
const botoes = () => [...document.querySelectorAll('button')].map(b => b.textContent?.trim())

test('pedido pendente fora de aprovação: Efetivar e Cancelar', async () => {
  await desenhar(PEDIDO)
  assert.ok(botoes().includes('Efetivar Venda'))
  assert.ok(botoes().includes('Cancelar'))
  assert.doesNotMatch(document.body.textContent ?? '', /Aguardando aprovação/)
})

test('pedido em aprovação: "Aguardando aprovação", sem Efetivar nem Cancelar', async () => {
  await desenhar({ ...PEDIDO, emAprovacao: true } as PedidoComDetalhes)
  assert.match(document.body.textContent ?? '', /Aguardando aprovação/)
  assert.ok(!botoes().includes('Efetivar Venda'))
  assert.ok(!botoes().includes('Cancelar'))
})

// Card com todas as motos (#25, V2 do Luis): pedido de várias motos lista cada uma com o valor e o total.
const moto = (id: string, modelo: string, final: string, valor: string | null) => ({ id, marca: 'MC', modelo, chassi: `9C2LA000000${final}`, cor: 'PRETA', valor })
const textoDe = (el: Element | null | undefined) => (el?.textContent ?? '').replace(/\s+/g, ' ')

test('pedido com 3 motos: o card diz "3 motos" e lista cada uma com o final do chassi, o valor e o total', async () => {
  await desenhar({ ...PEDIDO, motos: [moto('m1', 'JET', '4131', '9490.00'), moto('m2', 'PITICA', '0088', '5200.00'), moto('m3', 'X12', '2207', '9300.00')] } as PedidoComDetalhes)
  assert.match(textoDe(document.body), /3 motos/)
  const linhas = [...document.querySelectorAll('[aria-label="Motos do pedido"] li')].map(textoDe)
  assert.equal(linhas.length, 3)
  assert.match(linhas[0], /MC JET final 4131\s*R\$ 9\.490,00/)
  assert.match(linhas[2], /MC X12 final 2207\s*R\$ 9\.300,00/)
  assert.match(textoDe(document.body), /Total das motos\s*R\$ 23\.990,00/)
})

test('moto ainda sem valor aparece "A definir" e o total não sai pela metade', async () => {
  await desenhar({ ...PEDIDO, motos: [moto('m1', 'JET', '4131', null), moto('m2', 'PITICA', '0088', '5200.00')] } as PedidoComDetalhes)
  assert.match(textoDe(document.querySelector('[aria-label="Motos do pedido"]')), /MC JET final 4131\s*A definir/)
  assert.doesNotMatch(textoDe(document.body), /Total das motos/)
})

test('pedido de 1 moto: o card segue como antes (modelo, chassi e cor), sem a lista', async () => {
  await desenhar(PEDIDO)
  assert.match(textoDe(document.body), /MOTOCHEFE JET/)
  assert.ok(!document.querySelector('[aria-label="Motos do pedido"]'))
})

const trocarDeCard = async () => { const d = desmontarCard; desmontarCard = null; await d?.() }
// Editar pedido (#25, 25c, decisões 3 e 5 do Luis): quem cancela edita; em aprovação o botão some.
test('"Editar pedido" aparece para quem cancela o pedido pendente; some em aprovação e para o vendedor que não o criou', async () => {
  await desenhar(PEDIDO)
  assert.ok(botoes().includes('Editar pedido'))
  await trocarDeCard()
  await desenhar({ ...PEDIDO, emAprovacao: true } as PedidoComDetalhes)
  assert.ok(!botoes().includes('Editar pedido'))
  await trocarDeCard()
  await desenhar(PEDIDO, 'vendedor')
  assert.ok(!botoes().includes('Editar pedido'), 'vendedor u1 não criou o pedido (v1)')
})
