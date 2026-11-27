// Tela Lojas MotoChefe (#321): confirmação ao desmarcar, trava enquanto envia, recusa que volta ao valor de antes,
// estados vazios. A action é a fronteira de fora (mock); o resto da tela roda de verdade.
import { createElement } from 'react'
import test, { after, afterEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import { montarDom } from '@/test/montar-dom'
import { clicar } from '@/test/eventos-dom'
import type { ContaDaTela } from '@/lib/motochefe-marcacao'

const { desmontar: desmontarDom } = montarDom()
after(desmontarDom)

type Resposta = { ok: true; dados?: unknown } | { ok: false; erro: string }
const marcar = mock.fn(async (_entrada: unknown): Promise<Resposta> => ({ ok: true }))
const autorizar = mock.fn(async (_entrada: unknown): Promise<Resposta> => ({ ok: true }))
mock.module('../actions', { namedExports: {
  marcarLojaMotochefeAction: (e: unknown) => marcar(e),
  autorizarContaAction: (e: unknown) => autorizar(e),
} })

const montados: (() => Promise<void>)[] = []
afterEach(async () => {
  marcar.mock.resetCalls()
  autorizar.mock.resetCalls()
  marcar.mock.mockImplementation(async () => ({ ok: true }))
  autorizar.mock.mockImplementation(async () => ({ ok: true }))
  for (const desmontar of montados.splice(0)) await desmontar()
})

const CONTAS: ContaDaTela[] = [
  { id: 'a', nome: 'Conta A', autorizada: true, lojas: [
    { id: 'l1', nome: 'Centro', cidade: 'Alfa', ativa: true, marcada: true },
    { id: 'l2', nome: 'Norte', cidade: 'Beta', ativa: true, marcada: true },
    { id: 'l3', nome: 'Leste', cidade: 'Gama', ativa: true, marcada: false },
  ] },
  { id: 'b', nome: 'Conta B', autorizada: false, lojas: [{ id: 'l4', nome: 'Oeste', cidade: 'Ômega', ativa: true, marcada: true }] },
  { id: 'c', nome: 'Conta C', autorizada: false, lojas: [] },
]

async function montar(contas = CONTAS) {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { LojasMotochefe } = await import('./lojas-motochefe')
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => { root.render(createElement(LojasMotochefe, { contas })) })
  const esperar = () => act(() => new Promise(r => setTimeout(r, 30)))
  let montado = true
  montados.push(() => act(async () => { if (!montado) return; montado = false; root.unmount(); container.remove() }))
  return {
    clique: async (el: Element | null | undefined) => { await clicar(el); await esperar() },
    esperar,
  }
}

const texto = () => document.body.textContent ?? ''
const botao = (rotulo: string) => [...document.querySelectorAll('button')].find(b => (b.textContent ?? '').trim() === rotulo)
const interruptor = (rotulo: string) => document.querySelector<HTMLButtonElement>(`button[aria-label="${rotulo}"]`)
const contaNaLista = (nome: string) => [...document.querySelectorAll('button')].find(b => (b.textContent ?? '').startsWith(nome))

test('desmarcar loja pede confirmação e não grava antes da resposta', async () => {
  const { clique } = await montar()
  await clique(contaNaLista('Conta A'))
  await clique(interruptor('Loja MotoChefe: Centro'))
  assert.ok(texto().includes('Desmarcar Centro?'))
  assert.ok(texto().includes('Ela sai da API na hora, inclusive do histórico desde 01/2026'))
  assert.equal(marcar.mock.callCount(), 0)
})

test('cancelar a confirmação não grava', async () => {
  const { clique } = await montar()
  await clique(contaNaLista('Conta A'))
  await clique(interruptor('Loja MotoChefe: Centro'))
  await clique(botao('Cancelar'))
  assert.equal(marcar.mock.callCount(), 0)
  assert.equal(interruptor('Loja MotoChefe: Centro')?.getAttribute('aria-checked'), 'true')
})

test('confirmar desmarcar envia o id e o novo valor, e só esses', async () => {
  const { clique } = await montar()
  await clique(contaNaLista('Conta A'))
  await clique(interruptor('Loja MotoChefe: Centro'))
  await clique(botao('Desmarcar loja'))
  assert.deepEqual(marcar.mock.calls.map(c => c.arguments), [[{ lojaId: 'l1', marcada: false }]])
})

test('marcar loja desmarcada grava direto, sem diálogo', async () => {
  const { clique } = await montar()
  await clique(contaNaLista('Conta A'))
  await clique(interruptor('Loja MotoChefe: Leste'))
  assert.equal(texto().includes('Desmarcar Leste?'), false)
  assert.deepEqual(marcar.mock.calls.map(c => c.arguments), [[{ lojaId: 'l3', marcada: true }]])
})

test('enquanto envia, o interruptor e os botões do diálogo ficam travados', async () => {
  let liberar: () => void = () => {}
  marcar.mock.mockImplementationOnce(() => new Promise<Resposta>(r => { liberar = () => r({ ok: true }) }))
  const { clique, esperar } = await montar()
  await clique(contaNaLista('Conta A'))
  await clique(interruptor('Loja MotoChefe: Centro'))
  await clique(botao('Desmarcar loja'))
  assert.equal(botao('Cancelar')?.disabled, true)
  assert.equal(botao('Desmarcar loja')?.disabled, true)
  assert.equal(interruptor('Loja MotoChefe: Centro')?.disabled, true)
  assert.ok(texto().includes('Salvando'))
  liberar()
  await esperar()
})

// A recusa volta o interruptor ao valor de antes e diz que nada mudou, com o motivo do servidor.
test('recusa da action: o interruptor volta ao valor de antes, e a tela diz que nada mudou', async () => {
  marcar.mock.mockImplementationOnce(async () => ({ ok: false, erro: 'Sem permissão' }))
  const { clique } = await montar()
  await clique(contaNaLista('Conta A'))
  await clique(interruptor('Loja MotoChefe: Leste'))
  assert.equal(interruptor('Loja MotoChefe: Leste')?.getAttribute('aria-checked'), 'false')
  const alerta = document.querySelector('[role="alert"] p')?.textContent ?? ''
  assert.equal(alerta, 'Não deu para marcar a loja. Nada mudou. Tente de novo.')
  assert.ok(document.querySelector('[role="alert"] svg'), 'o alerta tem o ícone')
  assert.ok(botao('Tentar de novo'), 'o alerta tem o botão Tentar de novo')
})

test('falha inesperada (action lança) vira a frase de nada mudou, sem quebrar a tela', async () => {
  marcar.mock.mockImplementationOnce(async () => { throw new Error('banco fora') })
  const { clique } = await montar()
  await clique(contaNaLista('Conta A'))
  await clique(interruptor('Loja MotoChefe: Leste'))
  assert.equal(document.querySelector('[role="alert"] p')?.textContent, 'Não deu para marcar a loja. Nada mudou. Tente de novo.')
  assert.equal(interruptor('Loja MotoChefe: Leste')?.getAttribute('aria-checked'), 'false')
})

test('tirar a autorização pede confirmação; cancelar não grava', async () => {
  const { clique } = await montar()
  await clique(contaNaLista('Conta A'))
  await clique(interruptor('Autorizar custo, despesas e meta: Conta A'))
  assert.ok(texto().includes('Tirar a autorização da Conta A?'))
  assert.ok(texto().includes('Custo, despesas e meta das lojas dela saem da API na hora'))
  await clique(botao('Cancelar'))
  assert.equal(autorizar.mock.callCount(), 0)
})

test('ligar a autorização grava direto; confirmar a tirada envia só a Conta e o novo valor', async () => {
  const { clique } = await montar()
  await clique(contaNaLista('Conta B'))
  await clique(interruptor('Autorizar custo, despesas e meta: Conta B'))
  assert.deepEqual(autorizar.mock.calls.map(c => c.arguments), [[{ contaId: 'b', autorizada: true }]])
})

test('Conta sem loja diz que não tem lojas; sem nenhuma loja marcada, mostra o convite', async () => {
  const semMarcada = CONTAS.map(c => ({ ...c, lojas: c.lojas.map(l => ({ ...l, marcada: false })) }))
  const { clique } = await montar(semMarcada)
  assert.ok(texto().includes('Nenhuma loja marcada'))
  await clique(contaNaLista('Conta C'))
  assert.ok(texto().includes('Esta Conta ainda não tem lojas.'))
})

test('o painel mostra a Conta escolhida; Todas as Contas tira o painel e volta ao aviso da lista', async () => {
  const { clique } = await montar()
  await clique(contaNaLista('Conta A'))
  assert.ok(texto().includes('Lojas da Conta A'))
  await clique(botao('Todas as Contas'))
  assert.equal(texto().includes('Lojas da Conta A'), false)
  assert.ok(texto().includes('Escolha uma Conta à esquerda'))
})

// Diálogos de confirmação: sem o X, Escape só fecha fora do envio, clique fora nunca fecha, e tudo trava no envio.
const dialogo = () => document.querySelector<HTMLElement>('[data-slot="dialog-content"]')
const fundo = () => document.querySelector<HTMLElement>('[data-slot="dialog-overlay"]')
const tecla = (el: Element | null | undefined, key: string) => el?.dispatchEvent(new window.KeyboardEvent('keydown', { key, bubbles: true }))
const clicarFora = (el: Element | null | undefined) => {
  el?.dispatchEvent(new window.PointerEvent('pointerdown', { bubbles: true }))
  el?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
}

test('diálogo de desmarcar não tem o X: só Cancelar e Desmarcar loja', async () => {
  const { clique } = await montar()
  await clique(contaNaLista('Conta A'))
  await clique(interruptor('Loja MotoChefe: Centro'))
  const botoes = [...(dialogo()?.querySelectorAll('button') ?? [])].map(b => (b.textContent ?? '').trim())
  assert.deepEqual(botoes, ['Cancelar', 'Desmarcar loja'])
})

test('diálogo da autorização não tem o X: só Cancelar e Tirar autorização', async () => {
  const { clique } = await montar()
  await clique(contaNaLista('Conta A'))
  await clique(interruptor('Autorizar custo, despesas e meta: Conta A'))
  const botoes = [...(dialogo()?.querySelectorAll('button') ?? [])].map(b => (b.textContent ?? '').trim())
  assert.deepEqual(botoes, ['Cancelar', 'Tirar autorização'])
})

test('clique fora não fecha o diálogo de desmarcar, nem o de tirar a autorização', async () => {
  const { clique, esperar } = await montar()
  await clique(contaNaLista('Conta A'))
  await clique(interruptor('Loja MotoChefe: Centro'))
  clicarFora(fundo()); await esperar()
  assert.ok(texto().includes('Desmarcar Centro?'))
  await clique(botao('Cancelar'))
  await clique(interruptor('Autorizar custo, despesas e meta: Conta A'))
  clicarFora(fundo()); await esperar()
  assert.ok(texto().includes('Tirar a autorização da Conta A?'))
})

test('Escape fecha o diálogo quando não há envio', async () => {
  const { clique, esperar } = await montar()
  await clique(contaNaLista('Conta A'))
  await clique(interruptor('Loja MotoChefe: Centro'))
  tecla(dialogo(), 'Escape'); await esperar()
  assert.equal(texto().includes('Desmarcar Centro?'), false)
  assert.equal(marcar.mock.callCount(), 0)
})

test('durante o envio, Escape não fecha o diálogo nem solta a trava', async () => {
  let liberar: () => void = () => {}
  marcar.mock.mockImplementationOnce(() => new Promise<Resposta>(r => { liberar = () => r({ ok: true }) }))
  const { clique, esperar } = await montar()
  await clique(contaNaLista('Conta A'))
  await clique(interruptor('Loja MotoChefe: Centro'))
  await clique(botao('Desmarcar loja'))
  tecla(dialogo(), 'Escape'); await esperar()
  assert.ok(texto().includes('Desmarcar Centro?'))
  assert.equal(botao('Cancelar')?.disabled, true)
  liberar(); await esperar()
})

test('durante o envio da autorização, os botões do diálogo ficam travados', async () => {
  let liberar: () => void = () => {}
  autorizar.mock.mockImplementationOnce(() => new Promise<Resposta>(r => { liberar = () => r({ ok: true }) }))
  const { clique, esperar } = await montar()
  await clique(contaNaLista('Conta A'))
  await clique(interruptor('Autorizar custo, despesas e meta: Conta A'))
  await clique(botao('Tirar autorização'))
  assert.equal(botao('Cancelar')?.disabled, true)
  assert.equal(botao('Tirar autorização')?.disabled, true)
  assert.equal(interruptor('Autorizar custo, despesas e meta: Conta A')?.disabled, true)
  liberar(); await esperar()
})

// O valor mostrado no interruptor enquanto envia é o pedido, e o desfecho fecha ou volta o valor.
test('enquanto envia, o interruptor mostra o valor pedido; ao dar certo, o diálogo fecha', async () => {
  let liberar: () => void = () => {}
  marcar.mock.mockImplementationOnce(() => new Promise<Resposta>(r => { liberar = () => r({ ok: true }) }))
  const { clique, esperar } = await montar()
  await clique(contaNaLista('Conta A'))
  await clique(interruptor('Loja MotoChefe: Centro'))
  await clique(botao('Desmarcar loja'))
  assert.equal(interruptor('Loja MotoChefe: Centro')?.getAttribute('aria-checked'), 'false')
  liberar(); await esperar()
  assert.equal(texto().includes('Desmarcar Centro?'), false)
  assert.equal(document.querySelector('[role="alert"]'), null)
})

test('recusa: o interruptor volta ao valor de antes, o diálogo fecha e a frase aparece', async () => {
  marcar.mock.mockImplementationOnce(async () => ({ ok: false, erro: 'Sem permissão' }))
  const { clique } = await montar()
  await clique(contaNaLista('Conta A'))
  await clique(interruptor('Loja MotoChefe: Centro'))
  await clique(botao('Desmarcar loja'))
  assert.equal(interruptor('Loja MotoChefe: Centro')?.getAttribute('aria-checked'), 'true')
  assert.equal(texto().includes('Desmarcar Centro?'), false)
  assert.ok(document.querySelector('[role="alert"]'))
})

// O erro aparece acima da linha da loja, e Tentar de novo repete a mesma ação; dando certo, o erro some.
test('Tentar de novo repete a mesma ação, e dando certo o erro some', async () => {
  marcar.mock.mockImplementationOnce(async () => ({ ok: false, erro: 'Sem permissão' }))
  const { clique, esperar } = await montar()
  await clique(contaNaLista('Conta A'))
  await clique(interruptor('Loja MotoChefe: Leste'))
  await clique(botao('Tentar de novo'))
  await esperar()
  assert.deepEqual(marcar.mock.calls.map(c => c.arguments), [[{ lojaId: 'l3', marcada: true }], [{ lojaId: 'l3', marcada: true }]])
  assert.equal(document.querySelector('[role="alert"]'), null)
})

test('o erro fica acima da linha da loja, não abaixo', async () => {
  marcar.mock.mockImplementationOnce(async () => ({ ok: false, erro: 'Sem permissão' }))
  const { clique } = await montar()
  await clique(contaNaLista('Conta A'))
  await clique(interruptor('Loja MotoChefe: Leste'))
  const alerta = document.querySelector('[role="alert"]')!
  const linha = interruptor('Loja MotoChefe: Leste')!.closest('li')!
  assert.ok(linha.contains(alerta), 'o alerta fica dentro do item da loja')
  assert.ok(linha.firstElementChild === alerta || linha.firstElementChild?.contains(alerta), 'e vem antes do conteúdo da linha')
})

// O resumo é um cartão só, com as três colunas (no celular, uma embaixo da outra).
test('resumo: um cartão com três colunas, com os três números do protótipo', async () => {
  await montar()
  const resumo = document.querySelector<HTMLElement>('[data-resumo]')!
  assert.ok(resumo, 'o resumo tem a marca data-resumo')
  const colunas = [...resumo.children] as HTMLElement[]
  assert.equal(colunas.length, 3)
  assert.deepEqual(colunas.map(c => c.textContent), ['Lojas marcadas3 de 4', 'Contas com loja marcada2 de 3', 'Contas autorizadas para custo, despesas e meta1 de 3'])
})
