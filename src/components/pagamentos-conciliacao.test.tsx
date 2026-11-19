// Painel de pagamentos da conciliação (#79): quem vê o Forçar, o que forçar e desfazer enviam e o que
// a tela mostra quando a action recusa ou falha. As actions e o toast são a fronteira de fora; o resto roda de verdade.
import test, { after, afterEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import { montarDom } from '@/test/montar-dom'
import { digitarTexto } from '@/test/eventos-dom'
import { botao, clicar, esperar, montarDialogo } from '@/test/dialogo-em-tela'
import type { AlvoConciliacao } from '@/app/(dashboard)/conciliacao/actions'
import type { EstornoDoAlvo, PgtoOS } from '@/lib/conciliacao-status'
import type { ResultadoAction } from '@/lib/resultado-action'

const { desmontar: desmontarDom } = montarDom()
after(desmontarDom)

const forcar = mock.fn(async (_alvo: AlvoConciliacao, _idx: number, _motivo: string): Promise<ResultadoAction> => ({ ok: true, dados: undefined }))
const desfazer = mock.fn(async (_alvo: AlvoConciliacao, _idx: number): Promise<ResultadoAction> => ({ ok: true, dados: undefined }))
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const buscarPixLivres = mock.fn(async (..._a: unknown[]): Promise<any[]> => [])
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const buscarConciliacoesPorValor = mock.fn(async (..._a: unknown[]): Promise<any[]> => [])
const vincularVenda = mock.fn(async (..._a: unknown[]) => {})
const vincularPix = mock.fn(async (..._a: unknown[]) => {})
const actionsMock = mock.module('@/app/(dashboard)/conciliacao/actions', { namedExports: {
  forcarConciliacaoAction: (a: AlvoConciliacao, i: number, m: string) => forcar(a, i, m),
  desfazerConciliacaoForcadaAction: (a: AlvoConciliacao, i: number) => desfazer(a, i),
  buscarPixLivres: (...a: unknown[]) => buscarPixLivres(...a),
  buscarConciliacoesPorValor: (...a: unknown[]) => buscarConciliacoesPorValor(...a),
  buscarConciliacoesDoAlvo: async () => [],
  buscarPixDoAlvo: async () => [],
  buscarEstornosDoAlvo: async () => [],
  buscarConciliacoesLivres: async () => [],
  vincularVendaAction: (...a: unknown[]) => vincularVenda(...a),
  vincularPixAlvoAction: (...a: unknown[]) => vincularPix(...a),
} })
type AcaoDoToast = { action?: { label: string; onClick: () => void } }
const erros: string[] = []
const sucessos: { mensagem: string; opcoes?: AcaoDoToast }[] = []
const sonnerMock = mock.module('sonner', { namedExports: { toast: {
  error: (m: string) => { erros.push(m) },
  success: (mensagem: string, opcoes?: AcaoDoToast) => { sucessos.push({ mensagem, opcoes }) },
} } })
after(() => { actionsMock.restore(); sonnerMock.restore() })

const desmontagens: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const f of [forcar, desfazer, buscarPixLivres, buscarConciliacoesPorValor, vincularVenda, vincularPix]) f.mock.resetCalls()
  buscarPixLivres.mock.restore()
  buscarConciliacoesPorValor.mock.restore()
  forcar.mock.restore()
  desfazer.mock.restore()
  erros.length = 0
  sucessos.length = 0
  for (const desmontar of desmontagens.splice(0)) await desmontar()
})

const ALVO: AlvoConciliacao = { tipo: 'moto', id: 'venda-1' }
const FORCADO = { motivo: 'PIX na conta pessoal', porId: 'u1', porNome: 'Aux da loja', em: '2026-11-18T12:00:00.000Z' }
// Falha interna (rede, banco): a mensagem crua não pode ir para a tela.
const FALHA_INTERNA = new Error('connect ECONNREFUSED 10.0.0.1:5432')

// Botões das linhas de pagamento, na ordem da tela; o texto de cada um começa pelo tipo.
const linhas = () => [...document.querySelectorAll<HTMLButtonElement>('button[aria-expanded], li > button[disabled]')]
const linha = (tipo: string) => linhas().find(b => (b.textContent ?? '').startsWith(tipo))

async function montar(papel: string, pagamentos: PgtoOS[], estornos: EstornoDoAlvo[] = []) {
  const { PagamentosConciliacao } = await import('./pagamentos-conciliacao')
  const dados = { concs: [], pixRecs: [], estornos, loading: false, recarregar: async () => {} }
  const tela = await montarDialogo(PagamentosConciliacao, { alvo: ALVO, pagamentos, dados, papel })
  desmontagens.push(tela.desmontar)
  const tocar = (el: Element | undefined) => tela.act(async () => { clicar(el); await esperar(50) })
  const escreverMotivo = async (texto: string) => {
    await digitarTexto(document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Motivo"]')!, texto)
    await tela.act(() => esperar(20))
  }
  return { ...tela, tocar, escreverMotivo }
}

test('aux_adm abre o PIX pendente, força com o motivo e o Desfazer do aviso envia o mesmo pagamento', async () => {
  const { tocar, clique, escreverMotivo, act } = await montar('aux_adm', [{ tipo: 'dinheiro', valor: 200 }, { tipo: 'pix', valor: 1000 }])
  // O PIX pendente vem antes do dinheiro na tela, mas o índice enviado é o do array (1).
  assert.deepEqual(linhas().map(b => (b.textContent ?? '').slice(0, 8)), ['PIXPende', 'Dinheiro'])
  await tocar(linha('PIX'))
  await clique('Forçar')
  await escreverMotivo('PIX na conta pessoal')
  await clique('Marcar como recebido')

  assert.deepEqual(forcar.mock.calls.map(c => c.arguments), [[ALVO, 1, 'PIX na conta pessoal']])
  assert.equal(sucessos[0]?.mensagem, 'Pagamento marcado como recebido')
  await act(async () => { sucessos[0].opcoes!.action!.onClick(); await esperar(50) })
  assert.deepEqual(desfazer.mock.calls.map(c => c.arguments), [[ALVO, 1]])
})

test('aux_adm abre o financiamento pendente direto no Forçar, sem procurar lançamento', async () => {
  const { tocar } = await montar('aux_adm', [{ tipo: 'financiamento', valor: 8000 }])
  await tocar(linha('Financiamento'))
  assert.ok(botao('Forçar'))
  assert.equal(buscarPixLivres.mock.callCount() + buscarConciliacoesPorValor.mock.callCount(), 0)
})

test('recusa do forçar aparece no aviso e o formulário fica aberto com o motivo', async () => {
  forcar.mock.mockImplementation(async () => ({ ok: false, erro: 'Venda não encontrada' }))
  const { tocar, clique, escreverMotivo } = await montar('admin_socio', [{ tipo: 'pix', valor: 1000 }])
  await tocar(linha('PIX'))
  await clique('Forçar')
  await escreverMotivo('PIX na conta pessoal')
  await clique('Marcar como recebido')

  assert.deepEqual(erros, ['Venda não encontrada'])
  assert.equal(sucessos.length, 0)
  assert.equal(document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Motivo"]')?.value, 'PIX na conta pessoal')
})

test('falha interna do forçar mostra a frase genérica, sem a mensagem do erro', async () => {
  forcar.mock.mockImplementation(async () => { throw FALHA_INTERNA })
  const { tocar, clique, escreverMotivo } = await montar('aux_adm', [{ tipo: 'pix', valor: 1000 }])
  await tocar(linha('PIX'))
  await clique('Forçar')
  await escreverMotivo('PIX na conta pessoal')
  await clique('Marcar como recebido')
  assert.deepEqual(erros, ['Erro ao forçar conciliação'])
})

test('Desfazer forçado aparece para o aux_adm e envia o índice do array', async () => {
  const { clique } = await montar('aux_adm', [{ tipo: 'dinheiro', valor: 200 }, { tipo: 'pix', valor: 1000, conciliadoManual: FORCADO }])
  await clique('Desfazer forçado')
  assert.deepEqual(desfazer.mock.calls.map(c => c.arguments), [[ALVO, 1]])
  assert.deepEqual(sucessos.map(s => s.mensagem), ['Conciliação forçada desfeita'])
})

test('recusa do desfazer aparece no aviso; falha interna mostra a frase genérica', async () => {
  const { clique } = await montar('aux_adm', [{ tipo: 'pix', valor: 1000, conciliadoManual: FORCADO }])
  desfazer.mock.mockImplementation(async () => ({ ok: false, erro: 'Venda não encontrada' }))
  await clique('Desfazer forçado')
  desfazer.mock.mockImplementation(async () => { throw FALHA_INTERNA })
  await clique('Desfazer forçado')
  assert.deepEqual(erros, ['Venda não encontrada', 'Erro ao desfazer'])
  assert.equal(sucessos.length, 0)
})

test('vendedor não abre a linha pendente nem vê o Desfazer forçado', async () => {
  await montar('vendedor', [{ tipo: 'pix', valor: 1000 }, { tipo: 'cartao_credito', valor: 500, conciliadoManual: FORCADO }])
  assert.equal(linha('PIX')?.disabled, true)
  assert.equal(botao('Desfazer forçado'), undefined)
  assert.equal(botao('Forçar'), undefined)
})

// #51 (PR6c, V1): o PIX pode ter entrado pela maquininha Mercado Pago ou pelo banco; a busca olha as duas.
test('PIX pendente procura na maquininha e no banco; lista única com a origem; cada Vincular usa a sua action', async () => {
  buscarConciliacoesPorValor.mock.mockImplementation(async () => [{
    id: 'mp-1', operadora: 'mercadopago', autorizacao: null, nsu: '9900004821', valorBruto: '3550.00',
    dataTransacao: '2026-11-06', tipo: 'pix', rawData: null,
  }])
  buscarPixLivres.mock.mockImplementation(async () => [{
    id: 'bco-1', data: new Date('2026-11-06T17:32:00.000Z'), valor: '3548.00', pagadorNome: 'MARIA SOUZA', descricao: 'PIX recebido',
  }])
  const t = await montar('aux_adm', [{ tipo: 'pix', valor: 3550 }])
  await t.tocar(linha('PIX'))
  assert.deepEqual(buscarConciliacoesPorValor.mock.calls.map(c => c.arguments), [[3550, 'pix']])
  assert.deepEqual(buscarPixLivres.mock.calls.map(c => c.arguments), [[3550]])

  const sugestoes = [...document.querySelectorAll('button[aria-label^="Vincular"]')].map(b => b.getAttribute('aria-label'))
  assert.equal(sugestoes.length, 2, sugestoes.join(' | '))
  assert.match(sugestoes[0]!, /^Vincular PIX na maquininha Mercado Pago/)
  assert.match(sugestoes[1]!, /^Vincular PIX de MARIA SOUZA/)
  const texto = document.body.textContent ?? ''
  assert.ok(texto.includes('NSU 00004821') && texto.includes('Extrato do banco'), texto)

  await t.tocar(document.querySelector('button[aria-label^="Vincular PIX na maquininha"]')!)
  assert.deepEqual(vincularVenda.mock.calls.map(c => c.arguments), [['mp-1', 'venda-1', 'moto']])
  await t.tocar(linha('PIX'))
  await t.tocar(document.querySelector('button[aria-label^="Vincular PIX de MARIA"]')!)
  assert.deepEqual(vincularPix.mock.calls.map(c => c.arguments), [['bco-1', ALVO]])
})

test('cartão pendente procura só a linha de cartão, sem o PIX do banco', async () => {
  const t = await montar('aux_adm', [{ tipo: 'cartao_credito', valor: 1200, parcelas: 3 }])
  await t.tocar(linha('Cartão de Crédito'))
  assert.deepEqual(buscarConciliacoesPorValor.mock.calls.map(c => c.arguments), [[1200, 'cartao']])
  assert.equal(buscarPixLivres.mock.callCount(), 0)
})

// #51 (PR6c): pagamento que voltou a pendente pelo estorno diz isso, em vez de só "Pendente".
test('pagamento pendente com estorno da maquininha mostra "Estornado no Mercado Pago" com o dia', async () => {
  await montar('aux_adm', [{ tipo: 'pix', valor: 450 }, { tipo: 'pix', valor: 90 }], [
    { id: 'e1', valorBruto: '450.00', tipo: 'pix', dataTransacao: '2026-11-05' },
  ])
  const textos = linhas().map(b => (b.textContent ?? '').replace(/\s+/g, ' '))
  assert.ok(textos.some(t => t.includes('Estornado no Mercado Pago em 05/11/2026') && t.includes('450,00')), textos.join(' | '))
  assert.ok(!textos.some(t => t.includes('Estornado') && t.includes('90,00')), textos.join(' | '))
})
