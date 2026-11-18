// Painel de pagamentos da conciliação (#79): quem vê o Forçar, o que forçar e desfazer enviam e o que
// a tela mostra quando a action recusa. As actions e o toast são a fronteira de fora; o resto roda de verdade.
import { createElement } from 'react'
import test, { after, afterEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import { montarDom } from '@/test/montar-dom'
import { clicar, digitarTexto } from '@/test/eventos-dom'
import type { AlvoConciliacao } from '@/app/(dashboard)/conciliacao/actions'
import type { PgtoOS } from '@/lib/conciliacao-status'

const { desmontar: desmontarDom } = montarDom()
after(desmontarDom)

type Resposta = { ok: true; dados?: undefined } | { ok: false; erro: string }
const forcar = mock.fn(async (_alvo: AlvoConciliacao, _idx: number, _motivo: string): Promise<Resposta> => ({ ok: true }))
const desfazer = mock.fn(async (_alvo: AlvoConciliacao, _idx: number): Promise<Resposta> => ({ ok: true }))
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

const montados: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const f of [forcar, desfazer, buscarPixLivres, buscarConciliacoesPorValor]) f.mock.resetCalls()
  forcar.mock.restore()
  erros.length = 0
  sucessos.length = 0
  for (const desmontar of montados.splice(0)) await desmontar()
})

const ALVO: AlvoConciliacao = { tipo: 'moto', id: 'venda-1' }
const FORCADO = { motivo: 'PIX na conta pessoal', porId: 'u1', porNome: 'Aux da loja', em: '2026-11-18T12:00:00.000Z' }

const esperar = (ms: number) => new Promise(r => setTimeout(r, ms))
const botao = (rotulo: string) => [...document.querySelectorAll('button')].find(b => (b.textContent ?? '').trim() === rotulo)
// Botão da linha do pagamento: o único com aria-expanded cujo texto começa pelo tipo.
const linha = (tipo: string) => [...document.querySelectorAll('button[aria-expanded]')].find(b => (b.textContent ?? '').startsWith(tipo)) as HTMLButtonElement | undefined

async function montar(papel: string, pagamentos: PgtoOS[]) {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { PagamentosConciliacao } = await import('./pagamentos-conciliacao')
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  const dados = { concs: [], pixRecs: [], loading: false, recarregar: async () => {} }
  await act(async () => { root.render(createElement(PagamentosConciliacao, { alvo: ALVO, pagamentos, dados, papel })) })
  const clique = async (el: Element | undefined) => { await clicar(el); await act(() => esperar(50)) }
  let montado = true
  montados.push(() => act(async () => { if (!montado) return; montado = false; root.unmount(); container.remove() }))
  return { clique, act }
}

test('aux_adm abre o PIX pendente, força com o motivo e o Desfazer do aviso envia o mesmo pagamento', async () => {
  // Dinheiro antes do PIX: a tela reordena (pendente primeiro), mas o índice enviado é o do array.
  const { clique, act } = await montar('aux_adm', [{ tipo: 'dinheiro', valor: 200 }, { tipo: 'pix', valor: 1000 }])
  await clique(linha('PIX'))
  await clique(botao('Forçar'))
  await digitarTexto(document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Motivo"]')!, 'PIX na conta pessoal')
  await act(() => esperar(20))
  await clique(botao('Marcar como recebido'))

  assert.deepEqual(forcar.mock.calls.map(c => c.arguments), [[ALVO, 1, 'PIX na conta pessoal']])
  assert.equal(sucessos[0]?.mensagem, 'Pagamento marcado como recebido')
  await act(async () => { sucessos[0].opcoes!.action!.onClick(); await esperar(50) })
  assert.deepEqual(desfazer.mock.calls.map(c => c.arguments), [[ALVO, 1]])
})

test('aux_adm abre o financiamento pendente direto no Forçar, sem procurar lançamento', async () => {
  const { clique } = await montar('aux_adm', [{ tipo: 'financiamento', valor: 8000 }])
  await clique(linha('Financiamento'))
  assert.ok(botao('Forçar'))
  assert.equal(buscarPixLivres.mock.callCount() + buscarConciliacoesPorValor.mock.callCount(), 0)
})

test('recusa da action aparece no aviso e o formulário fica aberto com o motivo', async () => {
  forcar.mock.mockImplementation(async () => ({ ok: false, erro: 'Venda não encontrada' }))
  const { clique, act } = await montar('admin_socio', [{ tipo: 'pix', valor: 1000 }])
  await clique(linha('PIX'))
  await clique(botao('Forçar'))
  const motivo = document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Motivo"]')!
  await digitarTexto(motivo, 'PIX na conta pessoal')
  await act(() => esperar(20))
  await clique(botao('Marcar como recebido'))

  assert.deepEqual(erros, ['Venda não encontrada'])
  assert.equal(sucessos.length, 0)
  assert.equal(document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Motivo"]')?.value, 'PIX na conta pessoal')
})

test('Desfazer forçado aparece para o aux_adm e envia o índice do array', async () => {
  const { clique } = await montar('aux_adm', [{ tipo: 'dinheiro', valor: 200 }, { tipo: 'pix', valor: 1000, conciliadoManual: FORCADO }])
  await clique(botao('Desfazer forçado'))
  assert.deepEqual(desfazer.mock.calls.map(c => c.arguments), [[ALVO, 1]])
  assert.deepEqual(sucessos.map(s => s.mensagem), ['Conciliação forçada desfeita'])
})

test('vendedor não abre a linha pendente nem vê o Desfazer forçado', async () => {
  await montar('vendedor', [{ tipo: 'pix', valor: 1000 }, { tipo: 'cartao_credito', valor: 500, conciliadoManual: FORCADO }])
  assert.equal(linha('PIX')?.disabled, true)
  assert.equal(botao('Desfazer forçado'), undefined)
  assert.equal(botao('Forçar'), undefined)
})
