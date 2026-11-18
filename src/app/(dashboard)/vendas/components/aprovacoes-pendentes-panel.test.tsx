// Card de Aprovações pendentes (#876): o pedido "Abaixo do mínimo" mostra o quadro Mínimo, Venda e
// Líquido, com quanto cada um ficou abaixo do mínimo; sem snapshot, o card fica como antes.
import { createElement, type ReactNode } from 'react'
import test, { after, afterEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import type { AprovacaoPendente } from '@/lib/queries/motos'
import { montarDom } from '@/test/montar-dom'

const { desmontar } = montarDom()
after(desmontar)

// O Link de verdade agenda prefetch com `self`, que o JSDOM do teste não tem.
mock.module('next/link', { defaultExport: ({ href, children }: { href: string; children: ReactNode }) => createElement('a', { href }, children) })
const aprovadas: string[] = []
const recusadas: unknown[][] = []
let respostaDaRecusa: () => Promise<unknown> = async () => ({ ok: true })
mock.module('../actions', {
  namedExports: {
    aprovarVendaAction: async (id: string) => { aprovadas.push(id); return { ok: true } },
    recusarVendaAction: async (...a: unknown[]) => { recusadas.push(a); return respostaDaRecusa() },
  },
})

// O exemplo da issue: mínimo 10.000, venda de 9.950 em 12x, líquido 9.111,72 depois da taxa.
const ABAIXO_DO_MINIMO = {
  id: 'apr-1', origem: 'moto', motoId: 'moto-1', osId: null, lojaId: 'loja-1',
  valor: '9950.00', motivo: 'cliente pediu', tipo: 'valor_minimo',
  dadosVenda: { pagamentos: [{ tipo: 'cartao_credito', valor: 9950, parcelas: 12 }] },
  dataSolicitacao: new Date('2026-11-13T18:40:00Z'), vendedorNome: 'Vendedor Exemplo', lojaNome: 'Loja Exemplo',
  chassi: 'CHASSI1', cor: 'CINZA', marca: 'MOTOCHEFE', modelo: 'JETMAX', osNumero: null, osClienteNome: null,
  valorMinimoSnapshot: '10000.00', liquidoSnapshot: '9111.72', snapshotEstimado: false,
} as unknown as AprovacaoPendente

// O toLocaleString põe espaço não separável depois do "R$".
const texto = (el: Element | null | undefined) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim()
const itemDoQuadro = (rotulo: string) =>
  [...document.querySelectorAll('dt')].find(dt => texto(dt) === rotulo)?.parentElement
// Rótulo, valor e diferença do item, separados por espaço (no DOM eles vêm colados).
const textoDoItem = (rotulo: string) => [...(itemDoQuadro(rotulo)?.children ?? [])].map(texto).join(' ')
const textoDaTela = () => texto(document.body)

let desmontarPainel: (() => Promise<void>) | null = null
afterEach(async () => {
  await desmontarPainel?.()
  desmontarPainel = null
  document.body.innerHTML = ''
  aprovadas.length = 0
  recusadas.length = 0
  respostaDaRecusa = async () => ({ ok: true })
})

async function desenhar(aprovacao: AprovacaoPendente | AprovacaoPendente[], motosDosPedidos: Record<string, { id: string; marca: string; modelo: string }[]> = {}) {
  const React = (await import('react')).default
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { AprovacoesPendentesPanel } = await import('./aprovacoes-pendentes-panel')
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(React.createElement(AprovacoesPendentesPanel, {
      aprovacoes: Array.isArray(aprovacao) ? aprovacao : [aprovacao], motosDosPedidos, podeAprovarValorMinimo: true, podeAprovarSensivel: true,
    }))
  })
  desmontarPainel = () => act(async () => { root.unmount() })
}

test('abaixo do mínimo: o quadro mostra mínimo, venda e líquido com quanto cada um ficou abaixo', async () => {
  await desenhar(ABAIXO_DO_MINIMO)
  assert.equal(textoDoItem('Mínimo'), 'Mínimo R$ 10.000,00')
  assert.equal(textoDoItem('Venda'), 'Venda R$ 9.950,00 R$ 50,00 abaixo')
  assert.equal(textoDoItem('Líquido (12x)'), 'Líquido (12x) R$ 9.111,72 R$ 888,28 abaixo')
})

test('sem snapshot: nenhum quadro, o valor da venda continua no card', async () => {
  await desenhar({ ...ABAIXO_DO_MINIMO, valorMinimoSnapshot: null, liquidoSnapshot: null })
  assert.equal(itemDoQuadro('Mínimo'), undefined)
  assert.ok(textoDaTela().includes('R$ 9.950,00'))
  assert.ok(!textoDaTela().includes('abaixo'))
})

test('venda no mínimo e líquido abaixo: a Venda fica sem diferença, nada de "R$ 0,00 abaixo"', async () => {
  await desenhar({ ...ABAIXO_DO_MINIMO, valor: '10000.00', liquidoSnapshot: '9156.59' })
  assert.equal(textoDoItem('Venda'), 'Venda R$ 10.000,00')
  assert.equal(textoDoItem('Líquido (12x)'), 'Líquido (12x) R$ 9.156,59 R$ 843,41 abaixo')
  assert.ok(!textoDaTela().includes('R$ 0,00'))
})

test('financiamento ou transferência: o card não ganha quadro', async () => {
  await desenhar({ ...ABAIXO_DO_MINIMO, tipo: 'pagamento_sensivel', valorMinimoSnapshot: null, liquidoSnapshot: null })
  assert.equal(itemDoQuadro('Mínimo'), undefined)
  assert.ok(textoDaTela().includes('Financiamento/Transferência'))
})

// Pedido de venda em aprovação (#776): o mesmo card, com o número do pedido e moto + frete = total; o quadro
// segue sobre a moto (valor da aprovação sem o frete).
test('pedido em aprovação: número do pedido, moto + frete = total e o quadro sobre a moto', async () => {
  await desenhar({
    ...ABAIXO_DO_MINIMO, origem: 'pedido', valor: '11900.00', valorMinimoSnapshot: '12000.00', liquidoSnapshot: '11900.00',
    dadosVenda: { numero: 4321, frete: 150, pagamentos: [{ tipo: 'pix', valor: 12050 }] },
  } as unknown as AprovacaoPendente)
  assert.match(textoDaTela(), /Pedido #4321: MOTOCHEFE JETMAX/)
  assert.match(textoDaTela(), /Moto R\$ 11\.900,00 \+ frete R\$ 150,00 = R\$ 12\.050,00/)
  assert.match(textoDoItem('Venda'), /R\$ 11\.900,00/)
})

test('venda do Vender continua sem número de pedido nem linha de frete', async () => {
  await desenhar(ABAIXO_DO_MINIMO)
  assert.doesNotMatch(textoDaTela(), /Pedido #|frete/)
})

// Painel por pedido (#25, V2 do Luis): as linhas de um pedido (uma por moto abaixo do mínimo, D-D) viram um grupo, com o quadro
// de cada moto, a nota das que estão no mínimo e um "Aprovar pedido" / "Recusar pedido" só, que o servidor aplica a todas.
const doPedido = (id: string, motoId: string, modelo: string, chassi: string, valor: string, minimo: string, liquido: string) => ({
  ...ABAIXO_DO_MINIMO, id, origem: 'pedido', motoId, marca: 'MC', modelo, chassi, valor, valorMinimoSnapshot: minimo, liquidoSnapshot: liquido,
  dadosVenda: { pedidoId: 'p9', numero: 30158, pagamentos: [{ tipo: 'pix', valor: 23990 }] },
}) as unknown as AprovacaoPendente
const PEDIDO_DE_3 = [
  doPedido('apr-a', 'm2', 'PITICA', '9C2LA0000000088', '5200.00', '5490.00', '5200.00'),
  doPedido('apr-b', 'm3', 'X12', '9C2LA0000002207', '9300.00', '9990.00', '9300.00'),
]
const MOTOS_P9 = { p9: [{ id: 'm1', marca: 'MC', modelo: 'JET' }, { id: 'm2', marca: 'MC', modelo: 'PITICA' }, { id: 'm3', marca: 'MC', modelo: 'X12' }] }
const botao = (t: string) => [...document.querySelectorAll('button')].filter(b => texto(b) === t)

test('pedido com 2 de 3 motos abaixo: um grupo, um quadro por moto, a nota da moto no mínimo e um botão só de cada', async () => {
  await desenhar(PEDIDO_DE_3, MOTOS_P9)
  assert.match(textoDaTela(), /Pedido #30158: 2 de 3 motos abaixo do mínimo/)
  assert.equal([...document.querySelectorAll('dt')].filter(dt => texto(dt) === 'Mínimo').length, 2)
  assert.match(textoDaTela(), /MC PITICA final 0088/)
  assert.match(textoDaTela(), /1 moto no mínimo neste pedido \(MC JET\)\. Aprovar ou recusar responde o pedido inteiro\./)
  assert.deepEqual([botao('Aprovar pedido').length, botao('Recusar pedido').length, botao('Aprovar').length], [1, 1, 0])
})

test('"Aprovar pedido" chama a aprovação uma vez, com uma linha do pedido (o servidor responde as outras)', async () => {
  await desenhar(PEDIDO_DE_3, MOTOS_P9)
  const { act } = await import('react')
  await act(async () => { botao('Aprovar pedido')[0].click() })
  assert.deepEqual(aprovadas, ['apr-a'])
})

test('"Recusar pedido" pede a observação e recusa uma vez, com uma linha do pedido', async () => {
  await desenhar(PEDIDO_DE_3, MOTOS_P9)
  const { act } = await import('react')
  await act(async () => { botao('Recusar pedido')[0].click() })
  assert.match(textoDaTela(), /Recusar pedido #30158/)
  await act(async () => { botao('Confirmar recusa')[0].click() })
  assert.deepEqual(recusadas, [['apr-a', undefined]])
})

test('"Recusar pedido" leva a observação digitada', async () => {
  await desenhar(PEDIDO_DE_3, MOTOS_P9)
  const { act } = await import('react')
  const { digitarTexto } = await import('@/test/eventos-dom')
  await act(async () => { botao('Recusar pedido')[0].click() })
  await digitarTexto(document.querySelector('textarea') as HTMLTextAreaElement, 'Cliente desistiu')
  await act(async () => { botao('Confirmar recusa')[0].click() })
  assert.deepEqual(recusadas, [['apr-a', 'Cliente desistiu']])
})

test('enquanto recusa o pedido: Confirmar e Cancelar travados e Escape não fecha; ao responder, fecha', async () => {
  let responder!: () => void
  respostaDaRecusa = () => new Promise(r => { responder = () => r({ ok: true }) })
  await desenhar(PEDIDO_DE_3, MOTOS_P9)
  const { act } = await import('react')
  await act(async () => { botao('Recusar pedido')[0].click() })
  await act(async () => { botao('Confirmar recusa')[0].click() })
  assert.equal(botao('Recusando...')[0]?.disabled, true)
  assert.equal(botao('Cancelar')[0]?.disabled, true)
  await act(async () => { document.activeElement?.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
  assert.match(textoDaTela(), /Recusar pedido #30158/, 'Escape não fecha enquanto envia')
  await act(async () => { responder() })
  assert.doesNotMatch(textoDaTela(), /Recusar pedido #30158/)
})
