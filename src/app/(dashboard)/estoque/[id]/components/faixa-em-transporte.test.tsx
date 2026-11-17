// Faixa da moto em transporte e botão Chegou (#11, protótipo v2): o que aparece para quem pode e para
// quem não pode, o texto da confirmação, o que vai para o servidor e a trava enquanto envia. A action e
// o toast são a fronteira de fora; o resto roda de verdade.
import test, { after, afterEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import type { ResultadoAction } from '@/lib/resultado-action'
import { montarDom } from '@/test/montar-dom'
import { apertarEscape, botao, DEPOIS_DA_ANIMACAO_MS, dialogoAberto, esperar, montarDialogo, textoDaTela } from '@/test/dialogo-em-tela'

const { desmontar: desmontarDom } = montarDom()

const OK: ResultadoAction = { ok: true, dados: undefined }
const marcar = mock.fn(async (_motoId: string): Promise<ResultadoAction> => OK)
const sucesso = mock.fn((_msg: string) => {})
const mocks = [
  mock.module('../actions', { namedExports: { marcarChegadaAction: (id: string) => marcar(id) } }),
  mock.module('sonner', { namedExports: { toast: { success: (m: string) => sucesso(m), error: () => {} } } }),
]
after(() => { mocks.forEach(m => m.restore()); desmontarDom() })

const montados: (() => Promise<void>)[] = []
afterEach(async () => {
  marcar.mock.resetCalls(); sucesso.mock.resetCalls()
  marcar.mock.mockImplementation(async () => OK)
  for (const desmontar of montados.splice(0)) await desmontar()
})

const MOTO = { id: 'moto-1', modelo: 'JET', chassi: 'LA2026SA010004131', disponibilidade: null as string | null }
const PERGUNTA = 'A JET LA2026SA010004131 chegou na loja? Ela passa para Caixa e fica pronta para montar.'

async function montar(props: { podeMarcar: boolean; disponibilidade?: string | null }) {
  const { FaixaEmTransporte } = await import('./faixa-em-transporte')
  const t = await montarDialogo(FaixaEmTransporte, { moto: { ...MOTO, disponibilidade: props.disponibilidade ?? null }, podeMarcar: props.podeMarcar })
  montados.push(t.desmontar)
  return t
}

test('quem não pode marcar vê a faixa que avisa que a moto não chegou, sem o botão Chegou', async () => {
  await montar({ podeMarcar: false })
  assert.match(textoDaTela(), /Esta moto ainda não chegou na loja/)
  assert.match(textoDaTela(), /Pode ser reservada\. Montar, vender e transferir só depois da chegada\./)
  assert.equal(botao('Chegou'), undefined)
})

test('quem pode marcar vê o botão Chegou na faixa', async () => {
  await montar({ podeMarcar: true })
  assert.match(textoDaTela(), /Esta moto ainda não chegou na loja/)
  assert.ok(botao('Chegou'))
})

test('Chegou abre a confirmação "Marcar chegada" com o modelo e o chassi; sem reserva, não fala dela', async () => {
  const t = await montar({ podeMarcar: true })
  await t.clique('Chegou')
  assert.ok(dialogoAberto())
  assert.match(textoDaTela(), /Marcar chegada/)
  assert.match(textoDaTela(), new RegExp(PERGUNTA.replace(/[.?]/g, '\\$&')))
  assert.doesNotMatch(textoDaTela(), /A reserva continua/)
})

test('moto reservada: a confirmação avisa que a reserva continua', async () => {
  const t = await montar({ podeMarcar: true, disponibilidade: 'reservada' })
  await t.clique('Chegou')
  assert.match(textoDaTela(), /fica pronta para montar\. A reserva continua\./)
})

test('Marcar chegada envia só o id da moto, avisa o sucesso e fecha', async () => {
  const t = await montar({ podeMarcar: true })
  await t.clique('Chegou')
  await t.clique('Marcar chegada', DEPOIS_DA_ANIMACAO_MS)
  assert.deepEqual(marcar.mock.calls.map(c => c.arguments), [['moto-1']])
  assert.deepEqual(sucesso.mock.calls.map(c => c.arguments[0]), ['Chegada marcada. A moto agora está em Caixa.'])
  assert.equal(dialogoAberto(), false)
})

test('recusa do servidor: a frase aparece na confirmação, que continua aberta', async () => {
  marcar.mock.mockImplementation(async () => ({ ok: false, erro: 'Esta moto não está mais em transporte.' }))
  const t = await montar({ podeMarcar: true })
  await t.clique('Chegou')
  await t.clique('Marcar chegada', DEPOIS_DA_ANIMACAO_MS)
  assert.equal(document.querySelector('[role="alert"]')?.textContent, 'Esta moto não está mais em transporte.')
  assert.ok(dialogoAberto())
  assert.equal(sucesso.mock.callCount(), 0)
})

test('enquanto envia: Cancelar e Marcar chegada desabilitados, e o Escape não fecha', async () => {
  let responder: (r: ResultadoAction) => void = () => {}
  marcar.mock.mockImplementation(() => new Promise(r => { responder = r }))
  const t = await montar({ podeMarcar: true })
  await t.clique('Chegou')
  await t.clique('Marcar chegada')
  assert.ok(botao('Cancelar')?.disabled)
  assert.ok(botao('Marcar chegada')?.disabled)
  await t.act(async () => { apertarEscape(); await esperar(DEPOIS_DA_ANIMACAO_MS) })
  assert.ok(dialogoAberto())
  await t.act(async () => { responder(OK); await esperar(DEPOIS_DA_ANIMACAO_MS) })
})
