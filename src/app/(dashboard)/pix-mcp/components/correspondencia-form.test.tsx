// Formulário da correspondência do PIX em /pix-mcp (#90): o que lançar e desvincular enviam e o que a
// tela mostra quando a action recusa ou falha. As actions e o toast são a fronteira de fora.
import test, { after, afterEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import { montarDom } from '@/test/montar-dom'
import { digitar } from '@/test/eventos-dom'
import { esperar, montarDialogo } from '@/test/dialogo-em-tela'
import type { ResultadoAction } from '@/lib/resultado-action'
import type { Correspondencia } from './correspondencia-form'

const { desmontar: desmontarDom } = montarDom()
after(desmontarDom)

const lancar = mock.fn(async (_id: string, _tipo: string, _numero: string): Promise<ResultadoAction> => ({ ok: true, dados: undefined }))
const remover = mock.fn(async (_id: string): Promise<ResultadoAction> => ({ ok: true, dados: undefined }))
const actionsMock = mock.module('@/app/(dashboard)/pix-mcp/actions', { namedExports: {
  lancarCorrespondenciaAction: (i: string, t: string, n: string) => lancar(i, t, n),
  removerCorrespondenciaAction: (i: string) => remover(i),
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
  for (const f of [lancar, remover]) { f.mock.resetCalls(); f.mock.restore() }
  erros.length = 0
  sucessos.length = 0
  for (const desmontar of desmontagens.splice(0)) await desmontar()
})

const LIVRE: Correspondencia = { tipo: null, vendaNf: null, osNumero: null, pedidoNumero: null, pecaNumero: null, lancadoPorNome: null, lancadoEm: null }
const LIGADO: Correspondencia = { ...LIVRE, tipo: 'os', osNumero: 42 }
// Falha interna (rede, banco): a mensagem crua não pode ir para a tela.
const FALHA_INTERNA = new Error('connect ECONNREFUSED 10.0.0.1:5432')

async function montar(correspondencia: Correspondencia) {
  const { CorrespondenciaForm } = await import('./correspondencia-form')
  const tela = await montarDialogo(CorrespondenciaForm, { id: 'pix-1', correspondencia })
  desmontagens.push(tela.desmontar)
  const salvar = async (numero: string) => {
    await tela.act(async () => { digitar(document.querySelector<HTMLInputElement>('input[placeholder="Nº"]')!, numero) })
    await tela.clique('Salvar', 80)
  }
  const desvincular = () => tela.act(async () => {
    document.querySelector('button[aria-label="Desvincular OS #42"]')!.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await esperar(80)
  })
  return { salvar, desvincular }
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
