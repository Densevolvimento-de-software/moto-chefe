// Tela do catálogo de Serviços: quem não é admin_geral vê a lista com o status só como selo (sem
// "Novo Serviço", sem lápis, sem botão de ativar); com podeGerir, os três aparecem. As actions são a
// fronteira de fora; o resto roda de verdade.
import { createElement } from 'react'
import test, { after, afterEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import { montarDom } from '@/test/montar-dom'

const { desmontar: desmontarDom } = montarDom()
after(desmontarDom)

const ok = async () => ({ ok: true })
mock.module('../actions', { namedExports: {
  criarServicoAction: async () => ({ id: 'novo' }),
  atualizarServicoAction: ok,
  inativarServicoAction: ok,
  reativarServicoAction: ok,
} })
mock.module('sonner', { namedExports: { toast: { error: () => {}, success: () => {} } } })

const SERVICOS = [
  { id: 's-1', nome: 'Troca de óleo', tempoPrevistoMinutos: 30, valor: '120.00', ativo: true },
  { id: 's-2', nome: 'Revisão geral', tempoPrevistoMinutos: null, valor: '350.00', ativo: false },
]

const montados: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const desmontar of montados.splice(0)) await desmontar()
})

async function montar(podeGerir: boolean) {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { ServicosCatalogo } = await import('./servicos-catalogo')
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => { root.render(createElement(ServicosCatalogo, { servicos: SERVICOS, podeGerir })) })
  let montado = true
  montados.push(() => act(async () => { if (!montado) return; montado = false; root.unmount(); container.remove() }))
}

const texto = () => document.body.textContent ?? ''
const botoesDaLista = () => [...document.querySelectorAll('tbody button')]
const botaoDeAtivar = () => document.querySelector('button[title="Clique para inativar"]')

test('sem podeGerir (aux_adm, admin_socio): lista e status aparecem; sem Novo Serviço, sem lápis, sem botão de ativar', async () => {
  await montar(false)
  assert.ok(texto().includes('Troca de óleo') && texto().includes('Revisão geral'))
  assert.ok(texto().includes('Ativo') && texto().includes('Inativo'))
  assert.equal(texto().includes('Novo Serviço'), false)
  assert.equal(botoesDaLista().length, 0)
  assert.equal(botaoDeAtivar(), null)
})

test('com podeGerir (admin_geral): Novo Serviço, lápis e botão de ativar aparecem em cada linha', async () => {
  await montar(true)
  assert.ok(texto().includes('Novo Serviço'))
  assert.equal(botoesDaLista().length, SERVICOS.length * 2)
  assert.ok(botaoDeAtivar())
})
