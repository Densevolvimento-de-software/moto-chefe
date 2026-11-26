// Bloco "Entrada mínima da reserva" da Precificação (#283), variante A do protótipo. A action é a
// fronteira de fora; o resto roda de verdade.
import { createElement } from 'react'
import test, { after, afterEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import { montarDom } from '@/test/montar-dom'
import { clicar, digitar } from '@/test/eventos-dom'
import type { LojaComEntradaMinima } from '@/lib/entrada-minima-reserva'
import { esperar } from '@/test/dialogo-em-tela'
import { espacoComum } from '@/test/espaco-comum'

const { desmontar: desmontarDom } = montarDom()
after(desmontarDom)

type Resposta = { ok: true; dados: undefined } | { ok: false; erro: string }
const salvar = mock.fn(async (_entradas: unknown): Promise<Resposta> => ({ ok: true, dados: undefined }))
mock.module('../actions', { namedExports: { salvarEntradaMinimaReservaAction: (e: unknown) => salvar(e) } })
mock.module('sonner', { namedExports: { toast: { success: () => {}, error: () => {} } } })

const montados: (() => Promise<void>)[] = []
afterEach(async () => {
  salvar.mock.resetCalls()
  salvar.mock.mockImplementation(async () => ({ ok: true, dados: undefined }))
  for (const desmontar of montados.splice(0)) await desmontar()
})

const texto = () => espacoComum(document.body.textContent ?? '')
const campo = (loja: string) => document.querySelector(`input[aria-label="Entrada mínima da loja ${loja}"]`) as HTMLInputElement
const botaoSalvar = () => [...document.querySelectorAll('button')].find(b => /Salvar entradas/.test(b.textContent ?? '')) as HTMLButtonElement

const LOJAS: LojaComEntradaMinima[] = [
  { id: '11111111-1111-4111-8111-111111111111', nome: 'Loja Centro', pct: 30 },
  { id: '22222222-2222-4222-8222-222222222222', nome: 'Loja Norte', pct: 20 },
]

async function montar(lojas = LOJAS) {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { EntradaMinimaCard } = await import('./entrada-minima-card')
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => { root.render(createElement(EntradaMinimaCard, { lojas })) })
  let montado = true
  montados.push(() => act(async () => { if (!montado) return; montado = false; root.unmount(); container.remove() }))
  return { act }
}

test('mostra uma linha por loja com a porcentagem e quanto dá a entrada num modelo de R$ 15.000,00', async () => {
  await montar()
  assert.match(texto(), /Entrada mínima da reserva/)
  assert.match(texto(), /Num modelo de R\$ 15\.000,00/)
  assert.equal(campo('Loja Centro').value, '30')
  assert.equal(campo('Loja Norte').value, '20')
  assert.match(texto(), /Loja Centro.*R\$ 4\.500,00/)
  assert.match(texto(), /Loja Norte.*R\$ 3\.000,00/)
})

test('digitar outra porcentagem recalcula o exemplo daquela loja na hora', async () => {
  await montar()
  await digitar(campo('Loja Norte'), '25')
  assert.match(texto(), /Loja Norte.*R\$ 3\.750,00/)
})

test('porcentagem inválida mostra a frase no campo e o Salvar não chama o servidor', async () => {
  const t = await montar()
  for (const ruim of ['101', '2,5', '']) {
    await digitar(campo('Loja Norte'), ruim)
    await clicar(botaoSalvar())
    await t.act(() => esperar(10))
    assert.equal(campo('Loja Norte').getAttribute('aria-invalid'), 'true', ruim)
    assert.match(texto(), /número inteiro de 0 a 100/, ruim)
  }
  assert.equal(salvar.mock.calls.length, 0)
})

test('Salvar manda os pares loja e porcentagem de todas as lojas', async () => {
  const t = await montar()
  await digitar(campo('Loja Norte'), '0')
  await clicar(botaoSalvar())
  await t.act(() => esperar(10))
  assert.deepEqual(salvar.mock.calls.map(c => c.arguments[0]), [[
    { lojaId: LOJAS[0].id, pct: 30 },
    { lojaId: LOJAS[1].id, pct: 0 },
  ]])
})

test('recusa do servidor aparece como alerta', async () => {
  salvar.mock.mockImplementation(async () => ({ ok: false, erro: 'Loja não encontrada' }))
  const t = await montar()
  await clicar(botaoSalvar())
  await t.act(() => esperar(10))
  assert.match(document.querySelector('[role="alert"]')?.textContent ?? '', /Loja não encontrada/)
})

test('enquanto salva, o botão e os campos ficam travados', async () => {
  let liberar: (r: Resposta) => void = () => {}
  salvar.mock.mockImplementation(() => new Promise<Resposta>(r => { liberar = r }))
  const t = await montar()
  await clicar(botaoSalvar())
  assert.ok(botaoSalvar().disabled)
  assert.ok(campo('Loja Centro').disabled)
  await clicar(botaoSalvar())
  assert.equal(salvar.mock.calls.length, 1)
  await t.act(async () => { liberar({ ok: true, dados: undefined }); await esperar(10) })
  assert.ok(!botaoSalvar().disabled && !campo('Loja Centro').disabled)
})

test('grupo sem loja ativa: avisa e não deixa salvar', async () => {
  await montar([])
  assert.match(texto(), /Nenhuma loja ativa neste grupo/)
  assert.ok(botaoSalvar().disabled)
})
