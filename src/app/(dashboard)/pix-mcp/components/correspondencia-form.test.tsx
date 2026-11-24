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

const { dom, desmontar: desmontarDom } = montarDom()
after(desmontarDom)
// A confirmação abre em diálogo no desktop e na gaveta de baixo no celular (useIsDesktop); o JSDOM não tem matchMedia.
let desktop = true
const janela = dom.window as unknown as { matchMedia?: unknown }
janela.matchMedia = () => ({ matches: desktop, addEventListener: () => {}, removeEventListener: () => {} })
after(() => { delete janela.matchMedia })

const lancar = mock.fn(async (_id: string, _tipo: string, _numero: string): Promise<ResultadoAction<{ forcadasComCusto: number }>> => ({ ok: true, dados: { forcadasComCusto: 0 } }))
const remover = mock.fn(async (_id: string): Promise<ResultadoAction> => ({ ok: true, dados: undefined }))
const desfazerERemover = mock.fn(async (_id: string, _resumoVisto?: unknown): Promise<ResultadoAction> => ({ ok: true, dados: undefined }))
const forcadaDoPix = mock.fn(async (_id: string): Promise<ResultadoAction<ForcadaQueOPixCompleta | null>> => ({ ok: true, dados: null }))
const actionsMock = mock.module('@/app/(dashboard)/pix-mcp/actions', { namedExports: {
  lancarCorrespondenciaAction: (i: string, t: string, n: string) => lancar(i, t, n),
  removerCorrespondenciaAction: (i: string) => remover(i),
  desfazerForcadaERemoverAction: (i: string, r?: unknown) => desfazerERemover(i, r),
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
  desktop = true
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
  const redesenhar = (c: Correspondencia) => tela.redesenhar({ id: 'pix-1', correspondencia: c, podeDesfazerForcada })
  return { salvar, desvincular, act: tela.act, clique: tela.clique, redesenhar }
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
const RESUMO = { linhas: [{ valor: 1000, marcado: 600 }], cobre: 400 }
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
  assert.ok(tela().includes('O pagamento PIX de R$ 1.000,00 da OS #42 deixa de estar marcado como recebido, e este PIX fica livre para vincular de novo.'), tela())
  assert.equal(desfazerERemover.mock.callCount(), 0, 'só depois de confirmar')
  await clique('Desfazer e desvincular', 80)
  assert.deepEqual(desfazerERemover.mock.calls.map(c => c.arguments), [['pix-1', RESUMO]])
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
  assert.ok(tela().includes('Para desvincular, peça a quem pode desfazer a forçada (sócio, ou aux. adm. se o grupo permitir) para desfazer.'), tela())
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

test('a caixa com duas forçadas que o PIX completa, e o PIX cobrindo só parte do que falta', async () => {
  const { desvincular } = await montar(LIGADO, true)
  remover.mock.mockImplementation(async () => ({ ok: false, erro: COMPLETA }))
  forcadaDoPix.mock.mockImplementation(async () => ({ ok: true, dados: { linhas: [{ valor: 1000, marcado: 900 }, { valor: 500, marcado: 100 }], cobre: 300 } }))
  await desvincular()
  assert.ok(tela().includes('Os pagamentos PIX de R$ 1.000,00 e R$ 500,00 da OS #42 foram marcados como recebidos com R$ 900,00 e R$ 100,00. Este PIX cobre R$ 300,00 dos R$ 500,00 que faltam.'), tela())
})

test('a caixa some quando o PIX fica livre e não volta ao religar (U1)', async () => {
  const { desvincular, redesenhar } = await montar(LIGADO, true)
  remover.mock.mockImplementation(async () => ({ ok: false, erro: COMPLETA }))
  forcadaDoPix.mock.mockImplementation(async () => ({ ok: true, dados: RESUMO }))
  await desvincular()
  assert.ok(tela().includes(TEXTO_DA_CAIXA), tela())
  await redesenhar(LIVRE)
  await redesenhar(LIGADO)
  assert.equal(tela().includes('Este PIX completa um pagamento marcado como recebido'), false, tela())
})

test('falha interna no desfazer e desvincular mostra a frase genérica, nunca a mensagem crua', async () => {
  const { desvincular, clique } = await montar(LIGADO, true)
  remover.mock.mockImplementation(async () => ({ ok: false, erro: COMPLETA }))
  forcadaDoPix.mock.mockImplementation(async () => ({ ok: true, dados: RESUMO }))
  desfazerERemover.mock.mockImplementation(async () => { throw FALHA_INTERNA })
  await desvincular()
  await clique('Desfazer a forçada e desvincular')
  await clique('Desfazer e desvincular', 80)
  assert.deepEqual(erros, ['Erro ao desvincular'])
  assert.deepEqual(sucessos, [])
})

// Decisão do Luis registrada na #92 (27): no celular a confirmação é a gaveta de baixo do repo, como no protótipo v2.
const gavetaAberta = () => document.querySelector('[data-slot="sheet-content"]') !== null

test('celular: a confirmação abre na gaveta de baixo e confirmar desfaz e desvincula', async () => {
  desktop = false
  const { desvincular, clique } = await montar(LIGADO, true)
  remover.mock.mockImplementation(async () => ({ ok: false, erro: COMPLETA }))
  forcadaDoPix.mock.mockImplementation(async () => ({ ok: true, dados: RESUMO }))
  await desvincular()
  await clique('Desfazer a forçada e desvincular')
  assert.deepEqual([gavetaAberta(), dialogoAberto()], [true, false])
  assert.equal(document.querySelector('[data-slot="sheet-title"]')?.textContent, 'Desfazer a forçada e desvincular?')
  assert.ok(tela().includes('O pagamento PIX de R$ 1.000,00 da OS #42 deixa de estar marcado como recebido, e este PIX fica livre para vincular de novo.'), tela())
  await clique('Desfazer e desvincular', 80)
  assert.deepEqual(desfazerERemover.mock.calls.map(c => c.arguments), [['pix-1', RESUMO]])
  assert.deepEqual(sucessos, ['Forçada desfeita e correspondência desvinculada'])
})

test('celular: enquanto envia, os botões da gaveta travam e o Escape não fecha', async () => {
  desktop = false
  const { desvincular, clique, act } = await montar(LIGADO, true)
  remover.mock.mockImplementation(async () => ({ ok: false, erro: COMPLETA }))
  forcadaDoPix.mock.mockImplementation(async () => ({ ok: true, dados: RESUMO }))
  let responder: (r: ResultadoAction) => void = () => {}
  desfazerERemover.mock.mockImplementation(() => new Promise<ResultadoAction>(r => { responder = r }))
  await desvincular()
  await clique('Desfazer a forçada e desvincular')
  await clique('Desfazer e desvincular')
  assert.deepEqual([botao('Cancelar')?.disabled, botao('Desfazendo…')?.disabled], [true, true])
  await act(async () => {
    document.querySelector('[data-slot="sheet-content"]')!.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await esperar(50)
  })
  assert.equal(gavetaAberta(), true)
  await act(async () => { responder({ ok: true, dados: undefined }); await esperar(50) })
})

// Decisões 9 e 10 do Luis (#93): ligar ao pedido um PIX com custo faz a parte coberta das forçadas de PIX do pedido
// deixar de contar; a tela avisa quantas forçadas são.
test('lançar no pedido avisa quando o pedido tem forçadas de PIX com custo', async () => {
  const { salvar } = await montar(LIVRE)
  lancar.mock.mockImplementation(async () => ({ ok: true, dados: { forcadasComCusto: 2 } }))
  await salvar('123')
  assert.deepEqual(sucessos, ['Correspondência lançada. O custo do PIX de 2 forçadas deste pedido deixa de contar na parte que este PIX cobre.'])
  lancar.mock.mockImplementation(async () => ({ ok: true, dados: { forcadasComCusto: 1 } }))
  await salvar('124')
  assert.deepEqual(sucessos.slice(1), ['Correspondência lançada. O custo do PIX de 1 forçada deste pedido deixa de contar na parte que este PIX cobre.'])
})
