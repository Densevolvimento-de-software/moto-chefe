// Tela Lojas MotoChefe (#321): confirmação ao desmarcar, trava enquanto envia, recusa que volta ao valor de antes,
// estados vazios. A action é a fronteira de fora (mock); o resto da tela roda de verdade.
import { createElement } from 'react'
import test, { after, afterEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import { montarDom } from '@/test/montar-dom'
import { clicar } from '@/test/eventos-dom'
import { corDoGrupo } from '@/lib/grupo-cores'
import type { ContaDaTela } from '@/lib/motochefe-marcacao'

const { desmontar: desmontarDom } = montarDom()
after(desmontarDom)

type Resposta = { ok: true; dados?: unknown } | { ok: false; erro: string }
// Resposta da próxima chamada. Fica numa variável (e não em mockImplementationOnce, que sobrevive ao resetCalls)
// e volta ao padrão no afterEach.
const PADRAO = async (): Promise<Resposta> => ({ ok: true })
let respostaMarcar: () => Promise<Resposta> = PADRAO
let respostaAutorizar: () => Promise<Resposta> = PADRAO
const marcar = mock.fn(async (_entrada: unknown): Promise<Resposta> => respostaMarcar())
const autorizar = mock.fn(async (_entrada: unknown): Promise<Resposta> => respostaAutorizar())
mock.module('../actions', { namedExports: {
  marcarLojaMotochefeAction: (e: unknown) => marcar(e),
  autorizarContaAction: (e: unknown) => autorizar(e),
} })

const montados: (() => Promise<void>)[] = []
afterEach(async () => {
  marcar.mock.resetCalls()
  autorizar.mock.resetCalls()
  respostaMarcar = PADRAO
  respostaAutorizar = PADRAO
  for (const desmontar of montados.splice(0)) await desmontar()
})

const CONTAS: ContaDaTela[] = [
  { id: 'a', nome: 'Conta A', autorizada: true, lojas: [
    { id: 'l1', nome: 'Centro', cidade: 'Alfa', ativa: true, marcada: true },
    { id: 'l2', nome: 'Norte', cidade: 'Beta', ativa: true, marcada: true },
    { id: 'l3', nome: 'Leste', cidade: 'Gama', ativa: true, marcada: false },
    { id: 'l5', nome: 'Antiga', cidade: 'Delta', ativa: false, marcada: false },
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
    rerender: async (novas: ContaDaTela[]) => { await act(async () => { root.render(createElement(LojasMotochefe, { contas: novas })) }) },
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
  respostaMarcar = (() => new Promise<Resposta>(r => { liberar = () => r({ ok: true }) }))
  const { clique, esperar } = await montar()
  await clique(contaNaLista('Conta A'))
  await clique(interruptor('Loja MotoChefe: Centro'))
  await clique(botao('Desmarcar loja'))
  assert.equal(botao('Cancelar')?.disabled, true)
  assert.equal(botao('Desmarcar loja')?.disabled, true)
  assert.equal(interruptor('Loja MotoChefe: Centro')?.getAttribute('aria-disabled'), 'true')
  assert.ok(texto().includes('Salvando'))
  liberar()
  await esperar()
})

// A recusa volta o interruptor ao valor de antes e diz que nada mudou, com o motivo do servidor.
test('recusa da action: o interruptor volta ao valor de antes, e a tela diz que nada mudou', async () => {
  respostaMarcar = (async () => ({ ok: false, erro: 'Sem permissão' }))
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
  respostaMarcar = (async () => { throw new Error('banco fora') })
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
const tecla = async (el: Element | null | undefined, key: string) => {
  const { act } = await import('react')
  await act(async () => { el?.dispatchEvent(new window.KeyboardEvent('keydown', { key, bubbles: true })) })
}
const clicarFora = async (el: Element | null | undefined) => {
  const { act } = await import('react')
  await act(async () => {
    el?.dispatchEvent(new window.PointerEvent('pointerdown', { bubbles: true }))
    el?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  })
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
  await clicarFora(fundo()); await esperar()
  assert.ok(texto().includes('Desmarcar Centro?'))
  await clique(botao('Cancelar'))
  await clique(interruptor('Autorizar custo, despesas e meta: Conta A'))
  await clicarFora(fundo()); await esperar()
  assert.ok(texto().includes('Tirar a autorização da Conta A?'))
})

test('Escape fecha o diálogo quando não há envio', async () => {
  const { clique, esperar } = await montar()
  await clique(contaNaLista('Conta A'))
  await clique(interruptor('Loja MotoChefe: Centro'))
  await tecla(dialogo(), 'Escape'); await esperar()
  assert.equal(texto().includes('Desmarcar Centro?'), false)
  assert.equal(marcar.mock.callCount(), 0)
})

test('durante o envio, Escape não fecha o diálogo nem solta a trava', async () => {
  let liberar: () => void = () => {}
  respostaMarcar = (() => new Promise<Resposta>(r => { liberar = () => r({ ok: true }) }))
  const { clique, esperar } = await montar()
  await clique(contaNaLista('Conta A'))
  await clique(interruptor('Loja MotoChefe: Centro'))
  await clique(botao('Desmarcar loja'))
  await tecla(dialogo(), 'Escape'); await esperar()
  assert.ok(texto().includes('Desmarcar Centro?'))
  assert.equal(botao('Cancelar')?.disabled, true)
  liberar(); await esperar()
})

test('durante o envio da autorização, os botões do diálogo ficam travados', async () => {
  let liberar: () => void = () => {}
  respostaAutorizar = (() => new Promise<Resposta>(r => { liberar = () => r({ ok: true }) }))
  const { clique, esperar } = await montar()
  await clique(contaNaLista('Conta A'))
  await clique(interruptor('Autorizar custo, despesas e meta: Conta A'))
  await clique(botao('Tirar autorização'))
  assert.equal(botao('Cancelar')?.disabled, true)
  assert.equal(botao('Tirar autorização')?.disabled, true)
  assert.equal(interruptor('Autorizar custo, despesas e meta: Conta A')?.getAttribute('aria-disabled'), 'true')
  liberar(); await esperar()
})

// O valor mostrado no interruptor enquanto envia é o pedido, e o desfecho fecha ou volta o valor.
test('enquanto envia, o interruptor mostra o valor pedido; ao dar certo, o diálogo fecha', async () => {
  let liberar: () => void = () => {}
  respostaMarcar = (() => new Promise<Resposta>(r => { liberar = () => r({ ok: true }) }))
  const { clique, esperar } = await montar()
  await clique(contaNaLista('Conta A'))
  await clique(interruptor('Loja MotoChefe: Centro'))
  await clique(botao('Desmarcar loja'))
  assert.equal(interruptor('Loja MotoChefe: Centro')?.getAttribute('aria-checked'), 'false')
  liberar(); await esperar()
  assert.equal(texto().includes('Desmarcar Centro?'), false)
  assert.equal(document.querySelector('[role="alert"]') === null, true)
})

test('recusa: o interruptor volta ao valor de antes, o diálogo fecha e a frase aparece', async () => {
  respostaMarcar = (async () => ({ ok: false, erro: 'Sem permissão' }))
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
  respostaMarcar = (async () => ({ ok: false, erro: 'Sem permissão' }))
  const { clique, esperar } = await montar()
  await clique(contaNaLista('Conta A'))
  await clique(interruptor('Loja MotoChefe: Leste'))
  // A retentativa dá certo: a resposta de erro vale só para a primeira chamada.
  respostaMarcar = PADRAO
  await clique(botao('Tentar de novo'))
  await esperar()
  assert.deepEqual(marcar.mock.calls.map(c => c.arguments), [[{ lojaId: 'l3', marcada: true }], [{ lojaId: 'l3', marcada: true }]])
  assert.equal(document.querySelector('[role="alert"]') === null, true)
})

test('o erro fica acima da linha da loja, não abaixo', async () => {
  respostaMarcar = (async () => ({ ok: false, erro: 'Sem permissão' }))
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
  assert.deepEqual(colunas.map(c => c.textContent), ['Lojas marcadas3 de 5', 'Contas com loja marcada2 de 3', 'Contas autorizadas para custo, despesas e meta1 de 3'])
})

// A barra é a cor que a regra de grupo dá ao id da Conta. Prova: cada Conta recebe a classe que a regra dá ao
// seu id; a mesma Conta mantém a classe quando muda de posição na lista e quando muda de nome.
// As classes da barra (ela tem também as de layout): a classe da regra tem de estar entre elas.
const classesDaBarra = (id: string) => (document.querySelector<HTMLElement>(`[data-conta-id="${id}"] [data-barra-conta]`)?.className ?? '').split(' ')

test('a barra de cada Conta é a cor que a regra de grupo dá ao id da Conta', async () => {
  await montar()
  for (const c of CONTAS) {
    assert.ok(classesDaBarra(c.id).includes(corDoGrupo({ id: c.id }).bar), c.nome)
  }
  assert.ok(classesDaBarra('a').some(c => /^bg-grupo-(emerald|blue|amber|violet|rose|cyan|slate)$/.test(c)))
  assert.ok(classesDaBarra('a').every(c => !/#|\[/.test(c)), 'sem cor fixa nem valor arbitrário')
})

test('a mesma Conta mantém a sua barra ao mudar de posição na lista e ao mudar de nome', async () => {
  const { rerender } = await montar()
  const esperada = corDoGrupo({ id: 'a' }).bar
  await rerender([...CONTAS].reverse())
  assert.ok(classesDaBarra('a').includes(esperada), 'mudou de posição')
  await rerender(CONTAS.map(c => c.id === 'a' ? { ...c, nome: 'Conta Renomeada' } : c))
  assert.ok(classesDaBarra('a').includes(esperada), 'mudou de nome')
})

// Layout da linha como no protótipo: nome, coluna Ativa/Inativa e o interruptor; seta no Todas as Contas.
// Loja ativa e loja inativa de verdade (Antiga, na fixture): cada uma com o seu selo na coluna do meio.
test('linha da loja: nome, selo Ativa ou Inativa e o interruptor, nessa ordem', async () => {
  const { clique } = await montar()
  await clique(contaNaLista('Conta A'))
  const ativa = [...interruptor('Loja MotoChefe: Norte')!.closest('li')!.children] as HTMLElement[]
  assert.equal(ativa.length, 3)
  assert.equal(ativa[1].textContent, 'Ativa')
  assert.ok(ativa[2].querySelector('[role="switch"]'))
  const inativa = [...interruptor('Loja MotoChefe: Antiga')!.closest('li')!.children] as HTMLElement[]
  assert.equal(inativa[1].textContent, 'Inativa')
  assert.equal(inativa[1].className.includes('text-muted-foreground'), true, 'o selo Inativa usa a cor de texto secundário da tabela de contraste')
  assert.ok(inativa[0].querySelector('strong')!.className.includes('text-muted-foreground'), 'o nome da loja inativa aparece apagado')
  assert.equal(ativa[0].querySelector('strong')!.className.includes('text-muted-foreground'), false)
})

test('Todas as Contas tem a seta de volta, como no protótipo', async () => {
  const { clique } = await montar()
  await clique(contaNaLista('Conta A'))
  assert.ok(botao('Todas as Contas')?.querySelector('svg'), 'o botão tem a seta')
})

// Tentar de novo: ação sem volta nunca pula a confirmação; o erro e o pedido guardado somem ao trocar de Conta
// e quando a linha muda; pedido velho nunca é reenviado.
test('Tentar de novo em desmarcar reabre a confirmação, e só confirmar envia', async () => {
  respostaMarcar = async () => ({ ok: false, erro: 'Sem permissão' })
  const { clique, esperar } = await montar()
  await clique(contaNaLista('Conta A'))
  await clique(interruptor('Loja MotoChefe: Centro'))
  await clique(botao('Desmarcar loja'))
  assert.equal(marcar.mock.callCount(), 1)
  respostaMarcar = PADRAO
  await clique(botao('Tentar de novo'))
  assert.equal(marcar.mock.callCount(), 1, 'não enviou de novo sem confirmar')
  assert.ok(texto().includes('Desmarcar Centro?'), 'reabriu a confirmação')
  await clique(botao('Desmarcar loja'))
  await esperar()
  assert.deepEqual(marcar.mock.calls.map(c => c.arguments), [[{ lojaId: 'l1', marcada: false }], [{ lojaId: 'l1', marcada: false }]])
})

test('Tentar de novo em tirar a autorização reabre a confirmação, e só confirmar envia', async () => {
  respostaAutorizar = async () => ({ ok: false, erro: 'Sem permissão' })
  const { clique, esperar } = await montar()
  await clique(contaNaLista('Conta A'))
  await clique(interruptor('Autorizar custo, despesas e meta: Conta A'))
  await clique(botao('Tirar autorização'))
  assert.equal(autorizar.mock.callCount(), 1)
  respostaAutorizar = PADRAO
  await clique(botao('Tentar de novo'))
  assert.equal(autorizar.mock.callCount(), 1, 'não enviou de novo sem confirmar')
  assert.ok(texto().includes('Tirar a autorização da Conta A?'), 'reabriu a confirmação')
  await clique(botao('Tirar autorização'))
  await esperar()
  assert.deepEqual(autorizar.mock.calls.map(c => c.arguments), [[{ contaId: 'a', autorizada: false }], [{ contaId: 'a', autorizada: false }]])
})

test('trocar de Conta limpa o erro', async () => {
  respostaMarcar = async () => ({ ok: false, erro: 'Sem permissão' })
  const { clique } = await montar()
  await clique(contaNaLista('Conta A'))
  await clique(interruptor('Loja MotoChefe: Leste'))
  assert.ok(document.querySelector('[role="alert"]'))
  await clique(contaNaLista('Conta B'))
  await clique(contaNaLista('Conta A'))
  assert.equal(document.querySelector('[role="alert"]') === null, true, 'o erro da Conta A não volta ao reabri-la')
  assert.equal(botao('Tentar de novo') === undefined, true)
})

// Outro admin mexeu na loja: o pedido que falhou ficou velho. Some o erro e o Tentar de novo, e nada é enviado.
test('pedido velho não é reenviado: se a loja mudou desde a falha, o erro some e nada é enviado', async () => {
  respostaMarcar = async () => ({ ok: false, erro: 'Sem permissão' })
  const { clique, rerender } = await montar()
  await clique(contaNaLista('Conta A'))
  await clique(interruptor('Loja MotoChefe: Leste'))
  assert.ok(botao('Tentar de novo'))
  await rerender(CONTAS.map(c => c.id === 'a' ? { ...c, lojas: c.lojas.map(l => l.id === 'l3' ? { ...l, marcada: true } : l) } : c))
  assert.equal(document.querySelector('[role="alert"]') === null, true)
  assert.equal(botao('Tentar de novo') === undefined, true)
  assert.equal(marcar.mock.callCount(), 1, 'só a tentativa original')
})

test('pedido velho de desmarcar também não reabre nada: a loja já foi desmarcada por outro', async () => {
  respostaMarcar = async () => ({ ok: false, erro: 'Sem permissão' })
  const { clique, rerender } = await montar()
  await clique(contaNaLista('Conta A'))
  await clique(interruptor('Loja MotoChefe: Centro'))
  await clique(botao('Desmarcar loja'))
  await rerender(CONTAS.map(c => c.id === 'a' ? { ...c, lojas: c.lojas.map(l => l.id === 'l1' ? { ...l, marcada: false } : l) } : c))
  assert.equal(document.querySelector('[role="alert"]') === null, true)
  assert.equal(botao('Tentar de novo') === undefined, true)
  assert.equal(texto().includes('Desmarcar Centro?'), false)
  assert.equal(marcar.mock.callCount(), 1)
})

// Depois de dar certo, o interruptor segue o pedido até a página trazer o valor novo (sem piscar o antigo).
test('depois de dar certo, o interruptor segue o pedido até as props novas chegarem', async () => {
  const { clique, esperar, rerender } = await montar()
  await clique(contaNaLista('Conta A'))
  await clique(interruptor('Loja MotoChefe: Leste'))
  await esperar()
  assert.equal(interruptor('Loja MotoChefe: Leste')?.getAttribute('aria-checked'), 'true', 'a resposta chegou, as props ainda são as de antes')
  await rerender(CONTAS.map(c => c.id === 'a' ? { ...c, lojas: c.lojas.map(l => l.id === 'l3' ? { ...l, marcada: true } : l) } : c))
  assert.equal(interruptor('Loja MotoChefe: Leste')?.getAttribute('aria-checked'), 'true', 'props novas trazem o mesmo valor')
  await rerender(CONTAS.map(c => c.id === 'a' ? { ...c, lojas: c.lojas.map(l => l.id === 'l3' ? { ...l, marcada: false } : l) } : c))
  assert.equal(interruptor('Loja MotoChefe: Leste')?.getAttribute('aria-checked'), 'false', 'depois, o valor das props vale de novo')
})

// Props que chegam enquanto a action ainda roda: o pedido em curso segue até a resposta.
const comLojaMarcada = (lojaId: string, marcada: boolean) =>
  CONTAS.map(c => ({ ...c, lojas: c.lojas.map(l => l.id === lojaId ? { ...l, marcada } : l) }))
const valorDoInterruptor = (rotulo: string) => interruptor(rotulo)?.getAttribute('aria-checked')

test('props que chegam durante o envio não tiram o valor pedido; ao dar certo, segue igual', async () => {
  let liberar: () => void = () => {}
  respostaMarcar = () => new Promise<Resposta>(r => { liberar = () => r({ ok: true }) })
  const { clique, esperar, rerender } = await montar()
  await clique(contaNaLista('Conta A'))
  await clique(interruptor('Loja MotoChefe: Leste'))
  await rerender(comLojaMarcada('l3', true))
  assert.equal(valorDoInterruptor('Loja MotoChefe: Leste'), 'true', 'a página nova chegou no meio do envio')
  assert.equal(interruptor('Loja MotoChefe: Leste')?.getAttribute('aria-disabled'), 'true', 'ainda envia: segue travado')
  liberar(); await esperar()
  assert.equal(valorDoInterruptor('Loja MotoChefe: Leste'), 'true')
  assert.equal(interruptor('Loja MotoChefe: Leste')?.disabled, false)
})

test('props com o valor de antes chegam durante o envio, e a recusa devolve o interruptor ao valor das props com o erro', async () => {
  let liberar: () => void = () => {}
  respostaMarcar = () => new Promise<Resposta>(r => { liberar = () => r({ ok: false, erro: 'Sem permissão' }) })
  const { clique, esperar, rerender } = await montar()
  await clique(contaNaLista('Conta A'))
  await clique(interruptor('Loja MotoChefe: Leste'))
  await rerender(CONTAS)
  assert.equal(valorDoInterruptor('Loja MotoChefe: Leste'), 'true', 'o pedido continua mostrado enquanto envia')
  liberar(); await esperar()
  assert.equal(valorDoInterruptor('Loja MotoChefe: Leste'), 'false', 'a recusa volta ao valor das props')
  assert.equal(document.querySelector('[role="alert"] p')?.textContent, 'Não deu para marcar a loja. Nada mudou. Tente de novo.')
})

// Foco: o interruptor acionado não pode perder o foco durante o envio nem depois da resposta. Por isso a trava é
// aria-disabled (o botão segue focável) e o clique e o teclado são ignorados enquanto envia.
test('durante o envio, o interruptor segue focável: sem o atributo disabled, que tira o foco de quem o aciona', async () => {
  let liberar: () => void = () => {}
  respostaMarcar = () => new Promise<Resposta>(r => { liberar = () => r({ ok: true }) })
  const { clique, esperar } = await montar()
  await clique(contaNaLista('Conta A'))
  const sw = interruptor('Loja MotoChefe: Leste')!
  sw.focus()
  await clique(sw)
  assert.equal(sw.disabled, false)
  assert.equal(sw.getAttribute('aria-disabled'), 'true')
  assert.equal(document.activeElement === sw, true, 'o foco fica no interruptor enquanto envia')
  liberar(); await esperar()
  assert.equal(document.activeElement === sw, true, 'e continua nele depois de gravar')
})

test('durante o envio, clique repetido no interruptor não manda outro pedido nem abre diálogo', async () => {
  let liberar: () => void = () => {}
  respostaMarcar = () => new Promise<Resposta>(r => { liberar = () => r({ ok: true }) })
  const { clique, esperar } = await montar()
  await clique(contaNaLista('Conta A'))
  await clique(interruptor('Loja MotoChefe: Leste'))
  await clique(interruptor('Loja MotoChefe: Leste'))
  await clique(interruptor('Loja MotoChefe: Leste'))
  assert.equal(texto().includes('Desmarcar Leste?'), false, 'nenhum diálogo')
  liberar(); await esperar()
  assert.equal(marcar.mock.callCount(), 1, 'um pedido só')
})

test('depois da recusa, o foco continua no interruptor acionado', async () => {
  respostaMarcar = async () => ({ ok: false, erro: 'Sem permissão' })
  const { clique } = await montar()
  await clique(contaNaLista('Conta A'))
  const sw = interruptor('Loja MotoChefe: Leste')!
  sw.focus()
  await clique(sw)
  assert.equal(document.activeElement === sw, true, 'o foco fica no interruptor depois do erro')
  assert.ok(document.querySelector('[role="alert"]'), 'e o erro aparece')
})
