// Tela da chave da API (#322): cada botão manda o que deve, a confirmação trava enquanto envia, a chave nova aparece
// uma vez e some ao navegar. As actions e o roteador são a fronteira de fora (mock); a tela roda de verdade.
import { createElement } from 'react'
import test, { after, afterEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import { montarDom } from '@/test/montar-dom'
import { clicar } from '@/test/eventos-dom'
import { FRASE_ERRO_REVOGAR, FRASE_JA_TEM_CHAVE } from '@/lib/api-leitura'
import type { SituacaoDaChave } from '@/lib/queries/api-leitura'

const { desmontar: desmontarDom } = montarDom()
after(desmontarDom)

type Resposta = { ok: true; dados?: { chave: string } } | { ok: false; erro: string }
type Acao = 'gerar' | 'trocar' | 'revogar'
// Padrão igual à action real: gerar e trocar devolvem uma chave válida; revogar devolve só o ok.
const PADRAO = async (acao: Acao): Promise<Resposta> => (acao === 'revogar' ? { ok: true } : { ok: true, dados: { chave: CHAVE_TESTE } })
let resposta: (acao: Acao) => Promise<Resposta> = PADRAO
const gerar = mock.fn(async (): Promise<Resposta> => resposta('gerar'))
const trocar = mock.fn(async (): Promise<Resposta> => resposta('trocar'))
const revogar = mock.fn(async (): Promise<Resposta> => resposta('revogar'))
mock.module('../actions', { namedExports: {
  gerarChaveAction: () => gerar(),
  trocarChaveAction: () => trocar(),
  revogarChaveAction: () => revogar(),
} })
let atualizacoes = 0
mock.module('next/navigation', { namedExports: { useRouter: () => ({ refresh: () => { atualizacoes++ } }) } })

const AGORA = new Date('2026-11-28T12:00:00Z') // 09:00 em Brasília
const HORA = 60 * 60 * 1000
const CHAVE_TESTE = 'chave-de-teste-sintetica-0123456789-abcdefghij'
const SEM_CHAVE: SituacaoDaChave = { atual: null, anterior: null, limitePorMinuto: 60 }
const ATIVA: SituacaoDaChave = {
  atual: { geradaEm: new Date('2026-11-27T12:05:00Z'), geradaPor: 'admin_geral (teste)', ultimoUso: new Date('2026-11-28T13:28:00Z') },
  anterior: null,
  limitePorMinuto: 60,
}
const COM_ANTERIOR: SituacaoDaChave = { ...ATIVA, anterior: { validaAte: new Date(AGORA.getTime() + 18 * HORA) } }

const montados: (() => Promise<void>)[] = []
afterEach(async () => {
  gerar.mock.resetCalls(); trocar.mock.resetCalls(); revogar.mock.resetCalls()
  resposta = PADRAO
  atualizacoes = 0
  for (const desmontar of montados.splice(0)) await desmontar()
})

async function montar(situacao: SituacaoDaChave) {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { ChaveDaApi } = await import('./chave-da-api')
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => { root.render(createElement(ChaveDaApi, { situacao, agora: AGORA })) })
  const esperar = () => act(() => new Promise(r => setTimeout(r, 30)))
  let montado = true
  const desmontar = () => act(async () => { if (!montado) return; montado = false; root.unmount(); container.remove() })
  montados.push(desmontar)
  return {
    clique: async (el: Element | null | undefined) => { await clicar(el); await esperar() },
    esperar,
    rerender: async (nova: SituacaoDaChave) => { await act(async () => { root.render(createElement(ChaveDaApi, { situacao: nova, agora: AGORA })) }) },
    desmontar,
  }
}

const texto = () => document.body.textContent ?? ''
const botao = (rotulo: string) => [...document.querySelectorAll('button')].find(b => (b.textContent ?? '').trim() === rotulo)
const dialogo = () => document.querySelector<HTMLElement>('[data-slot="dialog-content"]')
// O botão de confirmar do diálogo, não o botão de mesmo nome da tela (que vem antes na página).
const botaoDoDialogo = (rotulo: string) => [...(dialogo()?.querySelectorAll('button') ?? [])].find(b => (b.textContent ?? '').trim() === rotulo)
const tecla = async (el: Element | null | undefined, key: string) => {
  const { act } = await import('react')
  await act(async () => { el?.dispatchEvent(new window.KeyboardEvent('keydown', { key, bubbles: true })) })
}

test('sem chave: aparece "Nenhuma chave gerada", e o botão Gerar chave manda gerar uma vez', async () => {
  const { clique } = await montar(SEM_CHAVE)
  assert.ok(texto().includes('Nenhuma chave gerada'))
  await clique(botao('Gerar chave'))
  assert.equal(gerar.mock.callCount(), 1)
})

test('gerar devolve a chave: ela aparece no bloco Chave nova, com o aviso de uma vez só e o botão Copiar', async () => {
  resposta = async () => ({ ok: true, dados: { chave: CHAVE_TESTE } })
  const { clique } = await montar(SEM_CHAVE)
  await clique(botao('Gerar chave'))
  assert.ok(texto().includes(CHAVE_TESTE), 'a chave aparece')
  assert.ok(texto().includes('Esta é a única vez que a chave aparece'))
  assert.ok(botao('Copiar chave'))
})

test('chave ativa: máscara sem nenhum caractere da chave, datas de Brasília, último uso e limite', async () => {
  await montar(ATIVA)
  assert.ok(texto().includes('••••'), 'a máscara aparece')
  assert.equal(texto().includes('mova_api'), false, 'sem prefixo que a chave gerada não tem')
  assert.ok(texto().includes('27/11/2026, 09:05'), 'gerada em, no horário de Brasília')
  assert.ok(texto().includes('28/11/2026, 10:28'), 'último uso, no horário de Brasília')
  assert.ok(texto().includes('60 chamadas por minuto'))
})

test('trocar sem chave anterior: a confirmação diz só a frase da chave atual; cancelar não chama; confirmar chama uma vez', async () => {
  const { clique } = await montar(ATIVA)
  await clique(botao('Trocar chave'))
  assert.ok(texto().includes('Gerar uma chave nova. A chave atual vale por mais 24 horas.'))
  assert.equal(texto().includes('para na hora'), false)
  await clique(botao('Cancelar'))
  assert.equal(trocar.mock.callCount(), 0)
  await clique(botao('Trocar chave'))
  await clique(botaoDoDialogo('Trocar chave'))
  assert.equal(trocar.mock.callCount(), 1, 'confirmar manda uma vez')
})

test('trocar com chave anterior no prazo: a confirmação diz até quando ela vale e que para na hora; confirmar chama uma vez', async () => {
  const { clique } = await montar(COM_ANTERIOR)
  assert.ok(texto().includes('Vale até 29/11/2026, 03:00'), 'a anterior mostra o fim do prazo')
  assert.ok(texto().includes('Faltam 18 horas'))
  await clique(botao('Trocar chave'))
  assert.ok(texto().includes('A chave anterior, que vale até 29/11/2026, 03:00, para na hora.'))
  await clique(botaoDoDialogo('Trocar chave'))
  assert.equal(trocar.mock.callCount(), 1)
  assert.ok(texto().includes(CHAVE_TESTE), 'a chave nova aparece depois de trocar')
})

test('revogar pede confirmação com o aviso do efeito; cancelar não chama; confirmar chama uma vez', async () => {
  const { clique } = await montar(ATIVA)
  await clique(botao('Revogar chave'))
  assert.ok(texto().includes('Revogar a chave agora?'))
  assert.ok(texto().includes('A integração da MotoChefe Brasil para na hora.'))
  await clique(botao('Cancelar'))
  assert.equal(revogar.mock.callCount(), 0)
  await clique(botao('Revogar chave'))
  await clique(botaoDoDialogo('Revogar chave'))
  assert.equal(revogar.mock.callCount(), 1)
})

test('enquanto envia, os botões ficam travados e Escape não fecha a confirmação', async () => {
  let liberar: () => void = () => {}
  resposta = () => new Promise<Resposta>(r => { liberar = () => r({ ok: true }) })
  const { clique, esperar } = await montar(ATIVA)
  await clique(botao('Revogar chave'))
  await clique(botaoDoDialogo('Revogar chave'))
  assert.equal((botaoDoDialogo('Revogar chave') as HTMLButtonElement).disabled, true, 'o botão de confirmar trava')
  await tecla(dialogo(), 'Escape')
  await esperar()
  assert.ok(dialogo(), 'Escape não fecha durante o envio')
  liberar(); await esperar()
  assert.equal(dialogo(), null, 'depois de dar certo, a confirmação fecha')
})

test('erro da gravação: mostra a frase; Tentar de novo na revogação reabre a confirmação, sem repetir sozinho', async () => {
  resposta = async () => ({ ok: false, erro: FRASE_ERRO_REVOGAR })
  const { clique } = await montar(ATIVA)
  await clique(botao('Revogar chave'))
  await clique(botaoDoDialogo('Revogar chave'))
  assert.ok(texto().includes(FRASE_ERRO_REVOGAR))
  await clique(botao('Tentar de novo'))
  assert.ok(texto().includes('Revogar a chave agora?'), 'a confirmação volta')
  assert.equal(revogar.mock.callCount(), 1)
})

test('frase de "já existe chave": o botão é Recarregar a página e só atualiza a tela, sem repetir a ação', async () => {
  resposta = async () => ({ ok: false, erro: FRASE_JA_TEM_CHAVE })
  const { clique } = await montar(SEM_CHAVE)
  await clique(botao('Gerar chave'))
  assert.ok(texto().includes(FRASE_JA_TEM_CHAVE))
  await clique(botao('Recarregar a página'))
  assert.equal(atualizacoes, 1)
  assert.equal(gerar.mock.callCount(), 1)
})

test('a chave some ao navegar: desmontada, não volta, e não fica na URL nem no armazenamento', async () => {
  resposta = async () => ({ ok: true, dados: { chave: CHAVE_TESTE } })
  const url = window.location.href
  const armazenado = () => [window.localStorage.length, window.sessionStorage.length]
  const antes = armazenado()
  const { clique, desmontar } = await montar(SEM_CHAVE)
  await clique(botao('Gerar chave'))
  assert.ok(texto().includes(CHAVE_TESTE))
  assert.equal(window.location.href, url, 'a chave não entra na URL')
  assert.deepEqual(armazenado(), antes, 'nada no armazenamento do navegador')
  await desmontar()
  await montar(ATIVA)
  assert.equal(texto().includes(CHAVE_TESTE), false, 'ao voltar à tela, a chave não está mais lá')
})

test('a chave nova continua na tela quando a página traz o estado novo (de vazio para ativa)', async () => {
  resposta = async () => ({ ok: true, dados: { chave: CHAVE_TESTE } })
  const { clique, rerender } = await montar(SEM_CHAVE)
  await clique(botao('Gerar chave'))
  await rerender(ATIVA)
  assert.ok(texto().includes(CHAVE_TESTE), 'a chave segue visível depois da atualização')
})

test('copiar manda a chave para a área de transferência e confirma na tela', async () => {
  resposta = async () => ({ ok: true, dados: { chave: CHAVE_TESTE } })
  const copiado = mock.fn(async (_t: string) => {})
  Object.defineProperty(window.navigator, 'clipboard', { value: { writeText: copiado }, configurable: true })
  const { clique } = await montar(SEM_CHAVE)
  await clique(botao('Gerar chave'))
  await clique(botao('Copiar chave'))
  assert.deepEqual(copiado.mock.calls.map(c => c.arguments[0]), [CHAVE_TESTE])
  assert.ok(texto().includes('Chave copiada.'))
})
