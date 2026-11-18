// Diálogo do "Cancelar venda" (#23): com várias motos no pedido, avisa que o pedido inteiro sai junto.
import { after, afterEach, mock, test } from 'node:test'
import assert from 'node:assert/strict'
import { montarDom } from '@/test/montar-dom'
import { montarDialogo, textoDaTela } from '@/test/dialogo-em-tela'

const { desmontar: desmontarDom } = montarDom()

const conferencia = { motosNoPedido: 1, numeroDoPedido: 30160 as number | null }
const nfeMock = mock.module('../nfe-propria-actions', {
  namedExports: { travaDoCancelamentoDaVendaAction: async () => ({ ok: true, trava: null, ...conferencia }) },
})
const actionsMock = mock.module('../actions', { namedExports: { cancelarVendaCompletaAction: async () => ({ ok: false, error: 'não usado' }) } })

let fechar: (() => Promise<void>) | null = null
afterEach(async () => { await fechar?.(); fechar = null; conferencia.motosNoPedido = 1 })
after(() => { nfeMock.restore(); actionsMock.restore(); desmontarDom() })

async function abrirDialogo() {
  const { createElement } = await import('react')
  const { CancelarVendaButton } = await import('./cancelar-venda-button')
  const d = await montarDialogo(CancelarVendaButton, {
    vendaId: 'venda-1', descricao: 'Venda 1',
    gatilho: (abrir: () => void) => createElement('button', { type: 'button', onClick: abrir }, 'Abrir'),
  })
  fechar = d.desmontar
  await d.clique('Abrir')
}

const AVISO = 'Esta venda é do pedido nº 30160, com 3 motos: as 3 vendas são canceladas juntas e as 3 motos voltam ao estoque.'

test('pedido com 3 motos: "Ao cancelar" diz que as 3 vendas e as 3 motos saem juntas', async () => {
  conferencia.motosNoPedido = 3
  await abrirDialogo()
  assert.ok(textoDaTela().includes(AVISO))
})

test('pedido de 1 moto: o diálogo fica como antes, sem o aviso do pedido', async () => {
  await abrirDialogo()
  assert.ok(textoDaTela().includes('A moto volta ao estoque como disponível'))
  assert.ok(!textoDaTela().includes('vendas são canceladas juntas'))
})
