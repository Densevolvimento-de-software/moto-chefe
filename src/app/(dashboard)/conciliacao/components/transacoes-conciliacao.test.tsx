// Transações da /conciliacao (#51, PR6b, V2): a tabela do desktop e a lista do celular com a folha de baixo. Linha
// estornada sai com o valor riscado, o selo e "Não se vincula", sem Vincular nem Desvincular; o servidor também recusa
// (`cartaoNaoEstornado`, src/lib/cartao-status.db.test.ts). As actions são a fronteira de fora.
import { test, after, afterEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import { montarDom } from '@/test/montar-dom'
import { DEPOIS_DA_ANIMACAO_MS, clicar, esperar, montarDialogo } from '@/test/dialogo-em-tela'
import type { LinhaNaTela } from '@/lib/conciliacao-linha-tela'

const { desmontar: desmontarDom } = montarDom()
after(desmontarDom)

const desvincular = mock.fn(async (_id: string) => ({ ok: true as const, dados: undefined }))
const vincular = mock.fn(async (_id: string, _alvo: { tipo: string; id: string }) => ({ ok: true as const, dados: undefined }))
const SUGERIDA = {
  id: 'v9', tipo: 'moto', numero: 32001, clienteNome: 'Ana Reis', valor: '3550.00', dataVenda: '2026-11-06T12:00:00.000Z',
  formaPagamento: 'PIX', pagamentos: [{ tipo: 'pix', valor: 3550 }, { tipo: 'cartao_credito', valor: 100, parcelas: 1 }],
}
const sugeridas = mock.fn(async () => [SUGERIDA] as unknown[])
const mocks = [
  mock.module('../actions', {
    namedExports: {
      buscarVendasParaVincular: () => sugeridas(), buscarVendaManual: async () => [],
      vincularVendaAction: vincular, desvincularVendaAction: desvincular,
    },
  }),
]
after(() => { for (const m of mocks) m.restore() })

const montados: (() => Promise<void>)[] = []
afterEach(async () => {
  desvincular.mock.resetCalls()
  vincular.mock.resetCalls()
  sugeridas.mock.restore()
  for (const d of montados.splice(0)) await d()
})

const BASE: LinhaNaTela = {
  id: 'c1', data: '2026-11-06', operadora: 'Mercado Pago', tipo: 'pix', rotulo: 'PIX', credito: false, bandeira: '', portador: '',
  valor: 3550, liquido: 3514.5, nsu: null, estornada: false, alvo: null,
}
const LINHAS: LinhaNaTela[] = [
  BASE,
  { ...BASE, id: 'c2', tipo: 'credito', rotulo: 'Cré 3x', credito: true, bandeira: 'visa', portador: 'MARIA S', valor: 8900, liquido: 8512.4,
    nsu: '123400009932', alvo: { id: 'v1', numero: 31902, clienteNome: 'Maria Souza', valor: '8900.00', tipo: 'moto' } },
  { ...BASE, id: 'c3', data: '2026-11-05', tipo: 'debito', rotulo: 'Déb', valor: 450, liquido: 446.4, estornada: true,
    alvo: { id: 'v2', numero: 31903, clienteNome: 'João Prado', valor: '450.00', tipo: 'moto' } },
]

async function montar(linhas: LinhaNaTela[] = LINHAS, podeVincular = true) {
  const { TransacoesConciliacao } = await import('./transacoes-conciliacao')
  const t = await montarDialogo(TransacoesConciliacao, { linhas, podeVincular })
  montados.push(t.desmontar)
  return t
}

const texto = (el: Element | null | undefined) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim()
const linhaDaTabela = (valor: string) => [...document.querySelectorAll('table tbody tr')].find(r => texto(r).includes(valor))
const itemDaLista = (valor: string) => [...document.querySelectorAll('ul[aria-label="Transações"] > li')].find(r => texto(r).includes(valor))
const botoes = (el: Element | undefined) => [...(el?.querySelectorAll('button') ?? [])].map(b => b.getAttribute('aria-label') ?? b.getAttribute('title') ?? texto(b))
const folha = () => document.querySelector('[data-slot="sheet-content"]')
const selos = (el: Element | null | undefined) => [...(el?.querySelectorAll('[data-slot="badge"]') ?? [])].map(texto)
const abrirFolha = (t: { act: (f: () => Promise<void>) => Promise<void> }, valor: string) =>
  t.act(async () => { clicar(itemDaLista(valor)!.querySelector('button')); await esperar(50) })

test('tabela: pendente com Vincular; ligada com a venda e Desvincular; estornada riscada, com selo, a venda do estorno e sem botões', async () => {
  await montar()
  assert.deepEqual(botoes(linhaDaTabela('R$ 3.550,00')), ['Vincular'])
  assert.deepEqual(selos(linhaDaTabela('R$ 3.550,00')), ['PIX'])

  const ligada = linhaDaTabela('R$ 8.900,00')
  assert.ok(texto(ligada).includes('#31902, Maria'), texto(ligada))
  assert.deepEqual(botoes(ligada), ['Desvincular'])

  const estornada = linhaDaTabela('R$ 450,00')
  assert.deepEqual(botoes(estornada), [])
  assert.deepEqual([...estornada!.querySelectorAll('s')].map(texto), ['R$ 450,00', 'R$ 446,40'])
  assert.ok(texto(estornada).includes('Estornado'), texto(estornada))
  assert.ok(texto(estornada).includes('Não se vincula'), texto(estornada))
  assert.deepEqual(selos(estornada), ['Déb', 'Estornado'])
  // Decisão do Luis (19/11): a tabela mostra de qual venda foi o estorno, como a folha do celular.
  assert.ok(texto(estornada).includes('#31903, João'), texto(estornada))
})

test('celular: pendente com Vincular; ligada com o número; estornada riscada, com selo e "Não se vincula"', async () => {
  await montar()
  assert.deepEqual(botoes(itemDaLista('R$ 3.550,00')).slice(1), ['Vincular'])
  assert.deepEqual(selos(itemDaLista('R$ 3.550,00')), ['PIX'])

  const ligada = itemDaLista('R$ 8.900,00')
  assert.deepEqual(botoes(ligada).slice(1), ['Abrir detalhes'])
  assert.ok(texto(ligada).includes('#31902'), texto(ligada))

  const estornada = itemDaLista('R$ 450,00')
  assert.deepEqual(botoes(estornada).slice(1), ['Abrir detalhes'])
  assert.deepEqual([...estornada!.querySelectorAll('s')].map(texto), ['R$ 450,00'])
  assert.deepEqual(selos(estornada), ['Estornado'])
  assert.ok(texto(estornada).includes('Estornado') && texto(estornada).includes('Não se vincula'), texto(estornada))
})

test('folha da ligada: detalhes e Desvincular chama a action da linha', async () => {
  const t = await montar()
  await abrirFolha(t, 'R$ 8.900,00')
  assert.equal(texto(folha()?.querySelector('[data-slot="sheet-title"]')), 'R$ 8.900,00')
  for (const esperado of ['06/11/2026', 'Mercado Pago, visa', 'R$ 8.512,40', '123400009932', 'MARIA S', '#31902, Maria Souza']) {
    assert.ok(texto(folha()).includes(esperado), `${esperado} em: ${texto(folha())}`)
  }
  await t.clique('Desvincular da venda')
  assert.deepEqual(desvincular.mock.calls.map(c => c.arguments), [['c2']])
})

test('folha da estornada: selos, a venda e "Não se vincula", sem Desvincular nem Vincular', async () => {
  const t = await montar()
  await t.act(async () => { clicar(itemDaLista('R$ 450,00')!.querySelector('button')); await esperar(50) })
  assert.ok(texto(folha()).includes('#31903, João Prado'), texto(folha()))
  assert.ok(texto(folha()).includes('Não se vincula: o dinheiro voltou ao cliente.'), texto(folha()))
  assert.deepEqual(selos(folha()), ['Déb', 'Estornado'])
  assert.deepEqual(botoes(folha() ?? undefined).filter(b => /vincular/i.test(b)), [])
})

test('linha que sai do filtro depois da action fecha a folha; a que fica mostra o estado novo', async () => {
  const t = await montar()
  await t.act(async () => { clicar(itemDaLista('R$ 8.900,00')!.querySelector('button')); await esperar(50) })
  // "Todas": a linha continua, agora sem venda.
  await t.redesenhar({ linhas: LINHAS.map(l => (l.id === 'c2' ? { ...l, alvo: null } : l)), podeVincular: true })
  assert.ok(botoes(folha() ?? undefined).includes('Vincular'), texto(folha()))
  // "Conciliadas": a linha sai da lista.
  await t.act(async () => { await t.redesenhar({ linhas: LINHAS.filter(l => l.id !== 'c2'), podeVincular: true }); await esperar(DEPOIS_DA_ANIMACAO_MS) })
  assert.equal(folha(), null)
})

test('Vincular de dentro da folha: o diálogo abre com a folha ainda aberta e escolher a venda chama a action com o id da linha', async () => {
  const t = await montar()
  await abrirFolha(t, 'R$ 3.550,00')
  const vincularNaFolha = [...folha()!.querySelectorAll('button')].find(b => texto(b) === 'Vincular')
  await t.act(async () => { clicar(vincularNaFolha); await esperar(50) })
  assert.equal(texto(document.querySelector('[data-slot="dialog-title"]')), 'Vincular a uma venda')
  assert.ok(folha(), 'a folha continua aberta embaixo')
  const sugerida = [...document.querySelectorAll('[data-slot="dialog-content"] button')].find(b => texto(b).includes('Venda #32001'))
  await t.act(async () => { clicar(sugerida); await esperar(50) })
  assert.deepEqual(vincular.mock.calls.map(c => c.arguments), [['c1', { tipo: 'moto', id: 'v9' }]])
})

// O servidor só vincula para quem gere a conciliação (`podeGerirConciliacao`); quem abre a tela por outro caminho
// vê as linhas e as vendas ligadas, sem os botões.
test('sem permissão de gerir: nenhum Vincular nem Desvincular na tabela, na lista e na folha; a venda ligada aparece', async () => {
  const t = await montar(LINHAS, false)
  const naTabela = [...document.querySelectorAll('table tbody tr')].flatMap(r => botoes(r))
  assert.deepEqual(naTabela, [])
  assert.ok(texto(linhaDaTabela('R$ 8.900,00')).includes('#31902, Maria'), texto(linhaDaTabela('R$ 8.900,00')))
  const naLista = [...document.querySelectorAll('ul[aria-label="Transações"] > li')].map(r => botoes(r).slice(1))
  assert.deepEqual(naLista, [['Abrir detalhes'], ['Abrir detalhes'], ['Abrir detalhes']])
  for (const valor of ['R$ 3.550,00', 'R$ 8.900,00']) {
    await abrirFolha(t, valor)
    assert.deepEqual(botoes(folha() ?? undefined).filter(b => /vincular/i.test(b)), [], valor)
  }
})

// O caso mais comum: o estorno chega antes de alguém ligar a linha a uma venda.
test('estornada sem venda ligada: sem Vincular na tabela, na lista e na folha', async () => {
  const sozinha: LinhaNaTela = { ...BASE, id: 'c5', tipo: 'credito', rotulo: 'Cré', credito: true, valor: 199, liquido: 190, estornada: true }
  const t = await montar([sozinha])
  assert.deepEqual(botoes(linhaDaTabela('R$ 199,00')), [])
  assert.ok(texto(linhaDaTabela('R$ 199,00')).includes('Não se vincula'), texto(linhaDaTabela('R$ 199,00')))
  assert.deepEqual(botoes(itemDaLista('R$ 199,00')).slice(1), ['Abrir detalhes'])
  await abrirFolha(t, 'R$ 199,00')
  assert.ok(texto(folha()).includes('Não se vincula: o dinheiro voltou ao cliente.'), texto(folha()))
  assert.deepEqual(botoes(folha() ?? undefined).filter(b => /vincular/i.test(b)), [])
})

// #51 (PR6c): a linha pix da maquininha cobre o pagamento PIX da venda.
test('Vincular da linha pix: selo "PIX na maquininha" e a venda sugerida mostra o pagamento PIX dela', async () => {
  const t = await montar()
  const vincularDaTabela = [...linhaDaTabela('R$ 3.550,00')!.querySelectorAll('button')].find(b => texto(b) === 'Vincular')
  await t.act(async () => { clicar(vincularDaTabela); await esperar(50) })
  const dialogo = document.querySelector('[data-slot="dialog-content"]')
  assert.ok(texto(dialogo).includes('PIX na maquininha'), texto(dialogo))
  const sugerida = [...(dialogo?.querySelectorAll('button') ?? [])].find(b => texto(b).includes('Venda #32001'))
  assert.ok(texto(sugerida).includes('PIX R$ 3.550,00'), texto(sugerida))
  assert.ok(!texto(sugerida).includes('Crédito'), texto(sugerida))
})

test('Vincular da linha pix sem venda no valor: o vazio fala de PIX', async () => {
  sugeridas.mock.mockImplementation(async () => [])
  const t = await montar()
  const vincularDaTabela = [...linhaDaTabela('R$ 3.550,00')!.querySelectorAll('button')].find(b => texto(b) === 'Vincular')
  await t.act(async () => { clicar(vincularDaTabela); await esperar(50) })
  assert.ok(texto(document.querySelector('[data-slot="dialog-content"]')).includes('Nenhuma venda com PIX no valor exato encontrada.'))
})
