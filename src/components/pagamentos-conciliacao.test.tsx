// Painel de pagamentos da conciliação (#79): quem vê o Forçar, o que forçar e desfazer enviam e o que
// a tela mostra quando a action recusa ou falha. As actions e o toast são a fronteira de fora; o resto roda de verdade.
import test, { after, afterEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import { montarDom } from '@/test/montar-dom'
import { digitarTexto } from '@/test/eventos-dom'
import { botao, clicar, esperar, montarDialogo } from '@/test/dialogo-em-tela'
import type { AlvoConciliacao } from '@/app/(dashboard)/conciliacao/actions'
import type { PgtoOS } from '@/lib/conciliacao-status'
import type { ResultadoAction } from '@/lib/resultado-action'

const { desmontar: desmontarDom } = montarDom()
after(desmontarDom)

const forcar = mock.fn(async (_alvo: AlvoConciliacao, _idx: number, _motivo: string): Promise<ResultadoAction> => ({ ok: true, dados: undefined }))
const desfazer = mock.fn(async (_alvo: AlvoConciliacao, _idx: number): Promise<ResultadoAction> => ({ ok: true, dados: undefined }))
const buscarPixLivres = mock.fn(async () => [])
const buscarConciliacoesPorValor = mock.fn(async () => [])
const actionsMock = mock.module('@/app/(dashboard)/conciliacao/actions', { namedExports: {
  forcarConciliacaoAction: (a: AlvoConciliacao, i: number, m: string) => forcar(a, i, m),
  desfazerConciliacaoForcadaAction: (a: AlvoConciliacao, i: number) => desfazer(a, i),
  buscarPixLivres: () => buscarPixLivres(),
  buscarConciliacoesPorValor: () => buscarConciliacoesPorValor(),
  buscarConciliacoesDoAlvo: async () => [],
  buscarPixDoAlvo: async () => [],
  buscarConciliacoesLivres: async () => [],
  vincularVendaAction: async () => {},
  vincularPixAlvoAction: async () => {},
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
  for (const f of [forcar, desfazer, buscarPixLivres, buscarConciliacoesPorValor]) f.mock.resetCalls()
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

async function montar(papel: string, pagamentos: PgtoOS[]) {
  const { PagamentosConciliacao } = await import('./pagamentos-conciliacao')
  const dados = { concs: [], pixRecs: [], loading: false, recarregar: async () => {} }
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
