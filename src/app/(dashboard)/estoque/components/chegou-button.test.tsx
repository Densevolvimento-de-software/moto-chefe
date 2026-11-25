// Botão Chegou da lista do Showroom (#277): um clique marca, sem janela de confirmação. A action, o aviso
// (sonner) e o roteador são a fronteira de fora; o botão roda de verdade.
import test, { after, afterEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import type { ResultadoAction } from '@/lib/resultado-action'
import { montarDom } from '@/test/montar-dom'
import { botao, DEPOIS_DA_ANIMACAO_MS, dialogoAberto, montarDialogo } from '@/test/dialogo-em-tela'

const { desmontar: desmontarDom } = montarDom()

const OK: ResultadoAction = { ok: true, dados: undefined }
const marcar = mock.fn(async (_motoId: string): Promise<ResultadoAction> => OK)
const sucesso = mock.fn((_titulo: string, _opcoes?: { description?: string }) => {})
const erro = mock.fn((_msg: string) => {})
const atualizar = mock.fn(() => {})
const mocks = [
  mock.module('../[id]/actions', { namedExports: { marcarChegadaAction: (id: string) => marcar(id) } }),
  mock.module('sonner', { namedExports: { toast: { success: (t: string, o?: { description?: string }) => sucesso(t, o), error: (m: string) => erro(m) } } }),
  mock.module('next/navigation', { namedExports: { useRouter: () => ({ refresh: () => atualizar() }) } }),
]
after(() => { mocks.forEach(m => m.restore()); desmontarDom() })

const montados: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const f of [marcar, sucesso, erro, atualizar]) f.mock.resetCalls()
  marcar.mock.mockImplementation(async () => OK)
  for (const desmontar of montados.splice(0)) await desmontar()
})

const DESCRICAO = 'JET · PRETO (Galpão Sul de Minas)'

async function montar() {
  const { ChegouButton } = await import('./chegou-button')
  const t = await montarDialogo(ChegouButton, { motoId: 'moto-1', descricao: DESCRICAO })
  montados.push(t.desmontar)
  return t
}

test('um clique marca a chegada, sem janela de confirmação, e o aviso diz qual moto foi para Caixa', async () => {
  const t = await montar()
  await t.clique('Chegou')
  assert.deepEqual(marcar.mock.calls.map(c => c.arguments), [['moto-1']])
  assert.equal(dialogoAberto(), false)
  assert.deepEqual(sucesso.mock.calls.map(c => c.arguments), [['Chegada marcada', { description: `${DESCRICAO} foi para Caixa.` }]])
  assert.equal(erro.mock.callCount(), 0)
})

test('enquanto envia: "Marcando" e desabilitado; outro clique não chama a action de novo', async () => {
  let responder: (r: ResultadoAction) => void = () => {}
  marcar.mock.mockImplementation(() => new Promise(r => { responder = r }))
  const t = await montar()
  await t.clique('Chegou')
  assert.equal(botao('Chegou'), undefined)
  assert.ok(botao('Marcando')?.disabled)
  assert.equal(botao('Marcando')?.getAttribute('aria-label'), `Marcando: ${DESCRICAO}`)
  await t.clique('Marcando')
  assert.equal(marcar.mock.callCount(), 1)
  await t.act(async () => { responder(OK) })
  assert.equal(botao('Chegou')?.disabled, false)
})
