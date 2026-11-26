// Diálogo "Registrar Reserva" (#283): o mínimo da entrada é a porcentagem da loja da moto, nos três
// lugares da tela (chip do topo, dica do campo e mensagem de erro). As actions são a fronteira de fora;
// o resto roda de verdade.
import test, { after, afterEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import { montarDom } from '@/test/montar-dom'
import { clicar, digitar } from '@/test/eventos-dom'
import { esperar, montarDialogo, textoDaTela } from '@/test/dialogo-em-tela'

const { desmontar: desmontarDom } = montarDom()
after(desmontarDom)

const TAXAS = { taxasCartao: {}, taxasDebito: {}, taxasLink: {}, taxasFinanciamento: {} }
const buscarPreco = mock.fn(async (_motoId: string) => ({ valorMinimoPix: 15000, entradaMinimaPct: 20, taxas: TAXAS }) as unknown)
mock.module('../../vendas/actions', { namedExports: {
  registrarVendaCompletaAction: async () => ({ ok: true, dados: undefined }),
  registrarReservaAction: async () => ({ ok: true, dados: undefined }),
  buscarPrecoMinimoAction: (id: string) => buscarPreco(id),
  buscarClientePorCpfAction: async () => null,
  solicitarAprovacaoVendaAction: async () => ({ ok: true, dados: undefined }),
} })
mock.module('@/components/use-maquininhas', { namedExports: { useMaquininhas: () => [] } })
mock.module('sonner', { namedExports: { toast: { success: () => {}, error: () => {} } } })

const montados: (() => Promise<void>)[] = []
afterEach(async () => {
  buscarPreco.mock.resetCalls()
  for (const desmontar of montados.splice(0)) await desmontar()
})

const espacoComum = (t: string) => t.replace(/ /g, ' ')
const tela = () => espacoComum(textoDaTela())
const campoDaEntrada = () => [...document.querySelectorAll('label')].find(l => /Valor da Entrada/.test(l.textContent ?? ''))!.parentElement!.querySelector('input') as HTMLInputElement

async function abrirReserva(props: { precoMinimoPix?: number; entradaMinimaPct?: number } = {}) {
  const { VenderButton } = await import('./vender-button')
  const t = await montarDialogo(VenderButton, {
    motoId: 'moto-1', descricao: 'X12 Azul', vendedorId: 'v-1', vendedorNome: 'Vendedor', papel: 'vendedor', usuarios: [],
    soReserva: true, showLabel: true, origens: [], taxasVenda: props.precoMinimoPix ? TAXAS : undefined, ...props,
  })
  montados.push(t.desmontar)
  const reservar = [...document.querySelectorAll('button')].find(b => /Reservar/.test(b.textContent ?? ''))
  await t.act(async () => { clicar(reservar); await esperar(30) })
  return t
}

test('com a porcentagem da loja vinda do detalhe da moto: chip, dica e erro usam os 20%', async () => {
  const t = await abrirReserva({ precoMinimoPix: 15000, entradaMinimaPct: 20 })
  assert.match(tela(), /Entrada: R\$ 3\.000,00 \(20%\)/)
  assert.match(tela(), /mín\. R\$ 3\.000,00 \(20% do preço PIX\)/)
  await digitar(campoDaEntrada(), '250000')
  await t.act(() => esperar(10))
  assert.match(tela(), /Mínimo de R\$ 3\.000,00 \(20% do preço PIX\)/)
  assert.doesNotMatch(tela(), /30%/)
  await digitar(campoDaEntrada(), '300000')
  await t.act(() => esperar(10))
  assert.doesNotMatch(tela(), /Mínimo de R\$ 3\.000,00/)
})

test('aberto pela lista (sem preço na prop): a porcentagem vem junto com o preço da busca', async () => {
  const t = await abrirReserva()
  assert.equal(buscarPreco.mock.calls.length, 1)
  assert.match(tela(), /Entrada: R\$ 3\.000,00 \(20%\)/)
  await digitar(campoDaEntrada(), '250000')
  await t.act(() => esperar(10))
  assert.match(tela(), /Mínimo de R\$ 3\.000,00 \(20% do preço PIX\)/)
})

test('loja com 0%: qualquer entrada passa, sem mensagem de mínimo', async () => {
  const t = await abrirReserva({ precoMinimoPix: 15000, entradaMinimaPct: 0 })
  await digitar(campoDaEntrada(), '100')
  await t.act(() => esperar(10))
  assert.match(tela(), /mín\. R\$ 0,00 \(0% do preço PIX\)/)
  assert.doesNotMatch(tela(), /Mínimo de/)
})
