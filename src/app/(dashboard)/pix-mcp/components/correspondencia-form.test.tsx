// Formulário da correspondência do PIX em /pix-mcp (#90): o que lançar e desvincular enviam e o que a
// tela mostra quando a action recusa ou falha. As actions e o toast são a fronteira de fora.
import test, { after, afterEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import { montarDom } from '@/test/montar-dom'
import { digitar } from '@/test/eventos-dom'
import { apertarEscape, botao, dialogoAberto, esperar, montarDialogo, textoDaTela } from '@/test/dialogo-em-tela'
import type { ResultadoAction } from '@/lib/resultado-action'
import type { Correspondencia } from './correspondencia-form'
import type { ForcadaQueOPixCompleta } from '@/lib/conciliacao-status'

const { desmontar: desmontarDom } = montarDom()
after(desmontarDom)

const lancar = mock.fn(async (_id: string, _tipo: string, _numero: string): Promise<ResultadoAction> => ({ ok: true, dados: undefined }))
const remover = mock.fn(async (_id: string): Promise<ResultadoAction> => ({ ok: true, dados: undefined }))
const desfazerERemover = mock.fn(async (_id: string): Promise<ResultadoAction> => ({ ok: true, dados: undefined }))
const forcadaDoPix = mock.fn(async (_id: string): Promise<ResultadoAction<ForcadaQueOPixCompleta | null>> => ({ ok: true, dados: null }))
const actionsMock = mock.module('@/app/(dashboard)/pix-mcp/actions', { namedExports: {
  lancarCorrespondenciaAction: (i: string, t: string, n: string) => lancar(i, t, n),
  removerCorrespondenciaAction: (i: string) => remover(i),
  desfazerForcadaERemoverAction: (i: string) => desfazerERemover(i),
  forcadaDoPixAction: (i: string) => forcadaDoPix(i),
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
  for (const f of [lancar, remover, desfazerERemover, forcadaDoPix]) { f.mock.resetCalls(); f.mock.restore() }
  erros.length = 0
  sucessos.length = 0
  for (const desmontar of desmontagens.splice(0)) await desmontar()
})

const LIVRE: Correspondencia = { tipo: null, vendaNf: null, osNumero: null, pedidoNumero: null, pecaNumero: null, lancadoPorNome: null, lancadoEm: null }
const LIGADO: Correspondencia = { ...LIVRE, tipo: 'os', osNumero: 42 }
// Falha interna (rede, banco): a mensagem crua não pode ir para a tela.
const FALHA_INTERNA = new Error('connect ECONNREFUSED 10.0.0.1:5432')

async function montar(correspondencia: Correspondencia, podeDesfazerForcada = false) {
  const { CorrespondenciaForm } = await import('./correspondencia-form')
  const tela = await montarDialogo(CorrespondenciaForm, { id: 'pix-1', correspondencia, podeDesfazerForcada })
  desmontagens.push(tela.desmontar)
  const salvar = async (numero: string) => {
    await tela.act(async () => { digitar(document.querySelector<HTMLInputElement>('input[placeholder="Nº"]')!, numero) })
    await tela.clique('Salvar', 80)
  }
  const desvincular = () => tela.act(async () => {
    document.querySelector('button[aria-label="Desvincular OS #42"]')!.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await esperar(80)
  })
  return { salvar, desvincular, act: tela.act, clique: tela.clique }
}

test('lançar envia o PIX, o tipo e o número; a recusa aparece com a frase da action', async () => {
  const { salvar } = await montar(LIVRE)
  lancar.mock.mockImplementation(async () => ({ ok: false, erro: 'NF 123 não encontrada no grupo Exemplo' }))
  await salvar('123')
  assert.deepEqual(lancar.mock.calls.map(c => c.arguments), [['pix-1', 'venda', '123']])
  assert.deepEqual(erros, ['NF 123 não encontrada no grupo Exemplo'])
  assert.deepEqual(sucessos, [])
})

test('lançar aceito avisa e limpa o número; falha interna mostra a frase genérica', async () => {
  const { salvar } = await montar(LIVRE)
  await salvar('123')
  assert.deepEqual(sucessos, ['Correspondência lançada'])
  assert.equal(document.querySelector<HTMLInputElement>('input[placeholder="Nº"]')!.value, '')
  lancar.mock.mockImplementation(async () => { throw FALHA_INTERNA })
  await salvar('124')
  assert.deepEqual(erros, ['Erro ao lançar correspondência'])
})

test('desvincular envia o PIX; a recusa aparece com a frase e a falha interna com a genérica', async () => {
  const { desvincular } = await montar(LIGADO)
  remover.mock.mockImplementation(async () => ({ ok: false, erro: 'PIX não encontrado no grupo ativo' }))
  await desvincular()
  remover.mock.mockImplementation(async () => { throw FALHA_INTERNA })
  await desvincular()
  remover.mock.mockImplementation(async () => ({ ok: true, dados: undefined }))
  await desvincular()
  assert.deepEqual(remover.mock.calls.map(c => c.arguments), [['pix-1'], ['pix-1'], ['pix-1']])
  assert.deepEqual(erros, ['PIX não encontrado no grupo ativo', 'Erro ao desvincular'])
  assert.deepEqual(sucessos, ['Correspondência desvinculada'])
})

// B2 da #92 (variante 2 do protótipo): o PIX completa uma forçada parcial. A caixa diz quanto; quem gere a
// conciliação desfaz a forçada e desvincula de uma vez, depois de confirmar.
const COMPLETA = 'Este PIX completa um pagamento marcado como recebido. Desfaça a forçada antes de desvincular.'
const PEDIR = 'Este PIX completa um pagamento marcado como recebido. Peça a quem gere a conciliação para desfazer a forçada.'
const RESUMO = { valor: 1000, marcado: 600, cobre: 400 }
const TEXTO_DA_CAIXA = 'O pagamento PIX de R$ 1.000,00 da OS #42 foi marcado como recebido com R$ 600,00. Este PIX cobre os R$ 400,00 que faltam.'
const tela = () => textoDaTela().replace(/\s+/g, ' ')

test('quem gere a conciliação: a recusa vira a caixa com os valores; confirmar no diálogo desfaz e desvincula', async () => {
  const { desvincular, clique } = await montar(LIGADO, true)
  remover.mock.mockImplementation(async () => ({ ok: false, erro: COMPLETA }))
  forcadaDoPix.mock.mockImplementation(async () => ({ ok: true, dados: RESUMO }))
  await desvincular()
  assert.ok(tela().includes('Este PIX completa um pagamento marcado como recebido'), tela())
  assert.ok(tela().includes(TEXTO_DA_CAIXA), tela())
  assert.deepEqual(forcadaDoPix.mock.calls.map(c => c.arguments), [['pix-1']])
  assert.deepEqual(erros, [])
  await clique('Desfazer a forçada e desvincular')
  assert.equal(dialogoAberto(), true)
  assert.ok(tela().includes('Desfazer a forçada e desvincular?'), tela())
  assert.ok(tela().includes('O pagamento PIX de R$ 1.000,00 da OS #42 volta a ficar pendente, e este PIX fica livre para vincular de novo.'), tela())
  assert.equal(desfazerERemover.mock.callCount(), 0, 'só depois de confirmar')
  await clique('Desfazer e desvincular', 80)
  assert.deepEqual(desfazerERemover.mock.calls.map(c => c.arguments), [['pix-1']])
  assert.deepEqual(sucessos, ['Forçada desfeita e correspondência desvinculada'])
  assert.deepEqual(erros, [])
})

test('enquanto desfaz e desvincula, os botões do diálogo travam e o Escape não fecha', async () => {
  const { desvincular, clique, act } = await montar(LIGADO, true)
  remover.mock.mockImplementation(async () => ({ ok: false, erro: COMPLETA }))
  forcadaDoPix.mock.mockImplementation(async () => ({ ok: true, dados: RESUMO }))
  let responder: (r: ResultadoAction) => void = () => {}
  desfazerERemover.mock.mockImplementation(() => new Promise<ResultadoAction>(r => { responder = r }))
  await desvincular()
  await clique('Desfazer a forçada e desvincular')
  await clique('Desfazer e desvincular')
  assert.deepEqual([botao('Cancelar')?.disabled, botao('Desfazendo…')?.disabled], [true, true])
  await act(async () => { apertarEscape(); await esperar(50) })
  assert.equal(dialogoAberto(), true)
  await act(async () => { responder({ ok: false, erro: 'PIX não encontrado no grupo ativo' }); await esperar(50) })
  assert.deepEqual(erros, ['PIX não encontrado no grupo ativo'])
})

test('quem não gere a conciliação: a caixa com os valores manda pedir a quem gere, sem botão de desfazer', async () => {
  const { desvincular } = await montar(LIGADO, false)
  remover.mock.mockImplementation(async () => ({ ok: false, erro: PEDIR }))
  forcadaDoPix.mock.mockImplementation(async () => ({ ok: true, dados: RESUMO }))
  await desvincular()
  assert.ok(tela().includes(TEXTO_DA_CAIXA), tela())
  assert.ok(tela().includes('Para desvincular, peça a quem gere a conciliação (sócio ou aux. adm.) para desfazer a forçada.'), tela())
  assert.equal(botao('Desfazer a forçada e desvincular')?.textContent ?? null, null)
  assert.deepEqual(erros, [])
})

test('sem o resumo (o PIX deixou de completar a forçada no meio), a recusa fica só com a frase', async () => {
  const { desvincular } = await montar(LIGADO, true)
  remover.mock.mockImplementation(async () => ({ ok: false, erro: COMPLETA }))
  await desvincular()
  assert.deepEqual(erros, [COMPLETA])
  assert.equal(tela().includes('Este PIX cobre'), false)
})
