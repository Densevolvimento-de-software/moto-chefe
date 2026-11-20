// Detalhes da venda (#93, variante B): "Valor líquido" com as sublinhas Taxa do cartão, Tarifa do PIX na
// maquininha e Custo do PIX, com os números que o servidor devolve. A action é a fronteira de fora.
import test, { after, afterEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import { montarDom } from '@/test/montar-dom'
import { esperar, montarDialogo } from '@/test/dialogo-em-tela'
import type { ResultadoAction } from '@/lib/resultado-action'

const { desmontar: desmontarDom } = montarDom()
after(desmontarDom)

type Custos = { taxaCartao: number; tarifaPix: number; custoPix: number; liquido: number }
const custos = mock.fn(async (_id: string): Promise<ResultadoAction<Custos | null>> => ({ ok: true, dados: null }))
const actionsMock = mock.module('../actions', { namedExports: { custosDaVendaAction: (id: string) => custos(id) } })
after(() => actionsMock.restore())

const desmontagens: (() => Promise<void>)[] = []
afterEach(async () => {
  custos.mock.resetCalls(); custos.mock.restore()
  for (const d of desmontagens.splice(0)) await d()
})

// O que a conciliação da venda tem no diálogo: lançamentos ligados e pagamentos (com as marcas de forçada).
type Conciliacao = { concs: { id: string }[]; pixRecs: { id: string }[]; pagamentos: { tipo: string; valor: number; conciliadoManual?: unknown }[] }
const SEM_NADA: Conciliacao = { concs: [], pixRecs: [], pagamentos: [{ tipo: 'pix', valor: 1000 }] }
async function montar(dados: Custos | null, conciliacao: Conciliacao = SEM_NADA) {
  custos.mock.mockImplementation(async () => ({ ok: true, dados }))
  const { CustosDaVenda } = await import('./custos-da-venda')
  const tela = await montarDialogo(CustosDaVenda, { vendaId: 'v-1', ...conciliacao })
  desmontagens.push(tela.desmontar)
  await tela.act(() => esperar(30))
  return tela
}
const texto = () => (document.body.textContent ?? '').replace(/\s+/g, ' ')
const sublinhas = () => [...document.querySelectorAll('[data-sublinha]')].map(s => [...s.querySelectorAll('span')].map(x => x.textContent).join(' '))

test('valor líquido com a taxa do cartão e o custo do PIX em sublinhas (aceite da #93)', async () => {
  await montar({ taxaCartao: 612, tarifaPix: 0, custoPix: 20, liquido: 17_868 })
  assert.deepEqual(custos.mock.calls.map(c => c.arguments), [['v-1']])
  assert.ok(texto().includes('Valor líquido'), texto())
  assert.ok(texto().includes('R$ 17.868,00'), texto())
  assert.deepEqual(sublinhas(), ['Taxa do cartão R$ 612,00', 'Custo do PIX R$ 20,00'])
})

test('a tarifa do PIX na maquininha tem sublinha própria; sublinha zerada não aparece', async () => {
  await montar({ taxaCartao: 0, tarifaPix: 4, custoPix: 0, liquido: 3_996 })
  assert.deepEqual(sublinhas(), ['Tarifa do PIX na maquininha R$ 4,00'])
})

test('sem custo nenhum (ou venda que não abre), o bloco não aparece', async () => {
  await montar({ taxaCartao: 0, tarifaPix: 0, custoPix: 0, liquido: 5_000 })
  assert.equal(texto().includes('Valor líquido'), false)
  await montar(null)
  assert.equal(texto().includes('Valor líquido'), false)
})

test('falha ao carregar não some calada: a tela diz que não deu para carregar (D1)', async () => {
  custos.mock.mockImplementation(async () => { throw new Error('connect ECONNREFUSED 10.0.0.1:5432') })
  const { CustosDaVenda } = await import('./custos-da-venda')
  const tela = await montarDialogo(CustosDaVenda, { vendaId: 'v-1', ...SEM_NADA })
  desmontagens.push(tela.desmontar)
  await tela.act(() => esperar(30))
  assert.ok(texto().includes('Não deu para carregar o valor líquido.'), texto())
  assert.equal(texto().includes('ECONNREFUSED'), false)
})

test('vincular um PIX ou forçar um pagamento no mesmo diálogo refaz a conta (B4); sem mudança, não', async () => {
  const tela = await montar({ taxaCartao: 0, tarifaPix: 0, custoPix: 20, liquido: 9_980 })
  const chamadas = () => custos.mock.callCount()
  await tela.redesenhar({ vendaId: 'v-1', ...SEM_NADA })
  await tela.act(() => esperar(30))
  assert.equal(chamadas(), 1, 'nada mudou, nada refaz')
  await tela.redesenhar({ vendaId: 'v-1', ...SEM_NADA, pixRecs: [{ id: 'pix-1' }] })
  await tela.act(() => esperar(30))
  assert.equal(chamadas(), 2, 'PIX vinculado')
  await tela.redesenhar({ vendaId: 'v-1', ...SEM_NADA, pixRecs: [{ id: 'pix-1' }], pagamentos: [{ tipo: 'pix', valor: 1000, conciliadoManual: { motivo: 'x' } }] })
  await tela.act(() => esperar(30))
  assert.equal(chamadas(), 3, 'pagamento forçado')
  await tela.redesenhar({ vendaId: 'v-1', ...SEM_NADA, concs: [{ id: 'c-1' }], pixRecs: [{ id: 'pix-1' }], pagamentos: [{ tipo: 'pix', valor: 1000, conciliadoManual: { motivo: 'x' } }] })
  await tela.act(() => esperar(30))
  assert.equal(chamadas(), 4, 'cartão conciliado')
})

test('a action recusa (ok: false): a tela diz que não deu para carregar (T2)', async () => {
  custos.mock.mockImplementation(async () => ({ ok: false, erro: 'Sem permissão' }))
  const { CustosDaVenda } = await import('./custos-da-venda')
  const tela = await montarDialogo(CustosDaVenda, { vendaId: 'v-1', ...SEM_NADA })
  desmontagens.push(tela.desmontar)
  await tela.act(() => esperar(30))
  assert.ok(texto().includes('Não deu para carregar o valor líquido.'), texto())
})
