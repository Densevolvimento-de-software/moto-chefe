// Tela do catálogo de Serviços, com e sem podeGerir. Sem ele, o teste prova que a lista e o status
// aparecem e que nenhum botão de criar, editar ou ativar/inativar está na tela. Com a recusa do servidor
// ({ ok: false, erro }), a frase chega ao usuário e a tela não finge sucesso. As actions são a
// fronteira de fora; o resto roda de verdade.
import { createElement } from 'react'
import test, { after, afterEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import { montarDom } from '@/test/montar-dom'
import { clicar, digitar } from '@/test/eventos-dom'
import { dialogoAberto, botao, esperar, DEPOIS_DA_ANIMACAO_MS } from '@/test/dialogo-em-tela'

const { desmontar: desmontarDom } = montarDom()
after(desmontarDom)

type Resposta = { ok: true; dados: unknown } | { ok: false; erro: string }
const SUCESSO: Resposta = { ok: true, dados: { id: 'novo' } }
const RECUSA: Resposta = { ok: false, erro: 'Serviço não encontrado' }
let resposta: Resposta = SUCESSO
const avisos: { tipo: 'erro' | 'sucesso'; texto: string }[] = []
const chamadas: string[] = []
const daAction = (nome: string) => async () => { chamadas.push(nome); return resposta }
mock.module('../actions', { namedExports: {
  criarServicoAction: daAction('criar'),
  atualizarServicoAction: daAction('atualizar'),
  inativarServicoAction: daAction('inativar'),
  reativarServicoAction: daAction('reativar'),
} })
mock.module('sonner', { namedExports: { toast: {
  error: (texto: string) => { avisos.push({ tipo: 'erro', texto }) },
  success: (texto: string) => { avisos.push({ tipo: 'sucesso', texto }) },
} } })

const SERVICOS = [
  { id: 's-1', nome: 'Troca de óleo', tempoPrevistoMinutos: 30, valor: '120.00', ativo: true },
  { id: 's-2', nome: 'Revisão geral', tempoPrevistoMinutos: null, valor: '350.00', ativo: false },
]

const montados: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const desmontar of montados.splice(0)) await desmontar()
  resposta = SUCESSO
  avisos.length = 0
  chamadas.length = 0
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

test('sem podeGerir: mostra o nome e o status de cada serviço, e nenhum botão na lista', async () => {
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

test('recusa do servidor ao inativar vira aviso com a frase, sem tela de sucesso', async () => {
  await montar(true)
  resposta = RECUSA
  await clicar(botaoDeAtivar())
  assert.deepEqual(avisos, [{ tipo: 'erro', texto: 'Serviço não encontrado' }])
})

test('recusa do servidor ao cadastrar mostra a frase e mantém o diálogo aberto com o que foi digitado', async () => {
  await montar(true)
  await clicar([...document.querySelectorAll('span')].find(e => e.textContent?.includes('Novo Serviço')))
  const nome = document.querySelector<HTMLInputElement>('input[placeholder="Ex: Troca de óleo"]')!
  await digitar(nome, 'Alinhamento')
  resposta = { ok: false, erro: 'Valor inválido' }
  await clicar(botao('Salvar'))
  await esperar(DEPOIS_DA_ANIMACAO_MS)
  assert.deepEqual(avisos, [{ tipo: 'erro', texto: 'Valor inválido' }])
  assert.equal(dialogoAberto(), true)
  assert.equal(document.querySelector<HTMLInputElement>('input[placeholder="Ex: Troca de óleo"]')!.value, 'Alinhamento')
})

test('cadastro aceito avisa o sucesso e fecha o diálogo', async () => {
  await montar(true)
  await clicar([...document.querySelectorAll('span')].find(e => e.textContent?.includes('Novo Serviço')))
  await digitar(document.querySelector<HTMLInputElement>('input[placeholder="Ex: Troca de óleo"]')!, 'Alinhamento')
  await clicar(botao('Salvar'))
  await esperar(DEPOIS_DA_ANIMACAO_MS)
  assert.deepEqual(avisos, [{ tipo: 'sucesso', texto: 'Serviço cadastrado!' }])
  assert.equal(dialogoAberto(), false)
})

test('recusa do servidor ao editar mostra a frase, mantém o diálogo aberto e não anuncia sucesso', async () => {
  await montar(true)
  const lapis = [...document.querySelectorAll('tbody tr:first-child button')].find(b => !b.hasAttribute('title'))
  await clicar(lapis)
  resposta = RECUSA
  await clicar(botao('Salvar'))
  await esperar(DEPOIS_DA_ANIMACAO_MS)
  assert.deepEqual(chamadas, ['atualizar'])
  assert.deepEqual(avisos, [{ tipo: 'erro', texto: 'Serviço não encontrado' }])
  assert.equal(dialogoAberto(), true)
})
