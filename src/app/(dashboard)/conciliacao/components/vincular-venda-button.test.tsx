// Botão de vincular da /conciliacao (#129): o que vincular e desvincular enviam e o que a tela mostra
// quando a action recusa. As actions e o toast são a fronteira de fora; o resto roda de verdade.
import test, { after, afterEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import { montarDom } from '@/test/montar-dom'
import { botao, clicar, dialogoAberto, esperar, montarDialogo, DEPOIS_DA_ANIMACAO_MS } from '@/test/dialogo-em-tela'
import type { AlvoConciliacao } from '@/lib/conciliacao-alvo'
import type { ResultadoAction } from '@/lib/resultado-action'
import { COMPLETA_FORCADA_PEDIR_A_GESTOR } from '@/lib/conciliacao-status'

const { desmontar: desmontarDom } = montarDom()
after(desmontarDom)

const item = (id: string, tipo: string, numero: number) =>
  ({ id, tipo, numero, dataVenda: '2026-11-12T12:00:00Z', clienteNome: 'Cliente Exemplo', valor: '1000.00', formaPagamento: 'cartao_credito', pagamentos: [] })
const SUGESTOES = [item('venda-1', 'moto', 321), item('peca-1', 'peca', 654), item('os-1', 'os', 987)]
const OK: ResultadoAction = { ok: true, dados: undefined }
const vincular = mock.fn(async (_id: string, _alvo: AlvoConciliacao): Promise<ResultadoAction> => OK)
const desvincular = mock.fn(async (_id: string): Promise<ResultadoAction> => OK)
const actionsMock = mock.module('../actions', { namedExports: {
  buscarVendasParaVincular: async () => SUGESTOES,
  buscarVendaManual: async () => [],
  vincularVendaAction: (c: string, a: AlvoConciliacao) => vincular(c, a),
  desvincularVendaAction: (c: string) => desvincular(c),
} })
const erros: string[] = []
const sucessos: string[] = []
const sonnerMock = mock.module('sonner', { namedExports: { toast: {
  error: (m: string) => { erros.push(m) },
  success: (m: string) => { sucessos.push(m) },
} } })
after(() => { actionsMock.restore(); sonnerMock.restore() })

const desmontagens: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const f of [vincular, desvincular]) { f.mock.resetCalls(); f.mock.restore() }
  erros.length = 0
  sucessos.length = 0
  for (const desmontar of desmontagens.splice(0)) await desmontar()
})

async function montar(vinculada = false) {
  const { VincularVendaButton } = await import('./vincular-venda-button')
  const props = {
    conciliacaoId: 'conc-1', dataRef: '2026-11-12', valorRef: 1000,
    ...(vinculada ? { vendaVinculada: { id: 'venda-1', numero: 321, clienteNome: 'Cliente Exemplo', valor: '1000.00' }, tipoVinculado: 'moto' as const } : {}),
  }
  const tela = await montarDialogo(VincularVendaButton, props)
  desmontagens.push(tela.desmontar)
  const tocar = (el: Element | undefined) => tela.act(async () => { clicar(el); await esperar(50) })
  return { tocar }
}

const itemDaLista = (texto: string) => [...document.querySelectorAll('button')].find(b => (b.textContent ?? '').includes(texto))

test('vincular recusado mostra a frase da action e o diálogo fica aberto', async () => {
  const { tocar } = await montar()
  await tocar(botao('Vincular'))
  vincular.mock.mockImplementation(async () => ({ ok: false, erro: 'Venda não encontrada' }))
  await tocar(itemDaLista('Venda #321'))
  await esperar(DEPOIS_DA_ANIMACAO_MS)
  assert.deepEqual(erros, ['Venda não encontrada'])
  assert.deepEqual(sucessos, [])
  assert.equal(dialogoAberto(), true)
})

test('guarda: vincular envia a linha e o alvo com o tipo do item (moto, peça, OS); o sucesso fecha o diálogo', async () => {
  for (const [texto, alvo] of [['Venda #321', { tipo: 'moto', id: 'venda-1' }], ['Venda #654', { tipo: 'peca', id: 'peca-1' }], ['OS #987', { tipo: 'os', id: 'os-1' }]] as const) {
    vincular.mock.resetCalls()
    sucessos.length = 0
    const { tocar } = await montar()
    await tocar(botao('Vincular'))
    await tocar(itemDaLista(texto))
    await esperar(DEPOIS_DA_ANIMACAO_MS)
    assert.deepEqual(vincular.mock.calls.map(c => c.arguments), [['conc-1', alvo]], texto)
    assert.deepEqual(sucessos, ['Venda vinculada'], texto)
    assert.equal(dialogoAberto(), false, texto)
    for (const desmontar of desmontagens.splice(0)) await desmontar()
  }
})

test('desvincular recusado mostra a frase da action, não "Vínculo removido"', async () => {
  const { tocar } = await montar(true)
  desvincular.mock.mockImplementation(async () => ({ ok: false, erro: 'Conciliação não encontrada' }))
  await tocar(document.querySelector('button[title="Desvincular"]') ?? undefined)
  assert.deepEqual(erros, ['Conciliação não encontrada'])
  assert.deepEqual(sucessos, [])
})

test('guarda: desvincular envia a linha e avisa o sucesso', async () => {
  const { tocar } = await montar(true)
  await tocar(document.querySelector('button[title="Desvincular"]') ?? undefined)
  assert.deepEqual(desvincular.mock.calls.map(c => c.arguments), [['conc-1']])
  assert.deepEqual(sucessos, ['Vínculo removido'])
})

// #220 (guarda da tela): quem não força recebe a frase de pedir ao gestor e a confirmação de desfazer não abre.
// A frase vem do servidor; a tela só não abre o diálogo quando ela não é a de desfazer.
test('guarda (#220): desvincular que completa forçada, sem poder forçar, mostra a frase de pedir ao gestor e não abre o diálogo', async () => {
  const { tocar } = await montar(true)
  desvincular.mock.mockImplementation(async () => ({ ok: false, erro: COMPLETA_FORCADA_PEDIR_A_GESTOR }))
  await tocar(document.querySelector('button[title="Desvincular"]') ?? undefined)
  assert.deepEqual(erros, [COMPLETA_FORCADA_PEDIR_A_GESTOR])
  assert.equal(dialogoAberto(), false)
})
