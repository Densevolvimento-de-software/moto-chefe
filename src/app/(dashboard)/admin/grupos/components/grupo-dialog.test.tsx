// Diálogo de grupo (#51, PR5, variante 1): o que o Editar envia da credencial do Mercado Pago, o que a tela
// mostra dela e a recusa do servidor à vista com o diálogo aberto (#404). Actions, roteador e toast são a
// fronteira de fora; o resto roda de verdade.
import test, { after, afterEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import type { ResultadoAction } from '@/lib/resultado-action'
import { montarDom } from '@/test/montar-dom'
import { apertarEscape, montarDialogo, textoDaTela } from '@/test/dialogo-em-tela'
import { FRASES_MP } from '@/lib/mercadopago/frases'
import type { GrupoDialog as Dialogo } from './grupo-dialog'

type Props = Parameters<typeof Dialogo>[0]

const { desmontar: desmontarDom } = montarDom()
after(desmontarDom)

type Dados = Record<string, unknown>
const api = {
  criar: mock.fn(async (_d: Dados): Promise<ResultadoAction> => ({ ok: true, dados: undefined })),
  editar: mock.fn(async (_id: string, _d: Dados): Promise<ResultadoAction<{ aviso: string | null }>> => ({ ok: true, dados: { aviso: null } })),
}
const toast = { success: mock.fn(), error: mock.fn(), warning: mock.fn() }
const mocks = [
  mock.module('../actions', { namedExports: {
    criarGrupoAction: (d: Dados) => api.criar(d),
    editarGrupoAction: (id: string, d: Dados) => api.editar(id, d),
  } }),
  mock.module('next/navigation', { namedExports: { useRouter: () => ({ refresh: () => {} }) } }),
  mock.module('sonner', { namedExports: { toast } }),
]
after(() => { for (const m of mocks) m.restore() })

const montados: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const m of [...Object.values(api), ...Object.values(toast)]) m.mock.resetCalls()
  api.criar.mock.mockImplementation(async () => ({ ok: true, dados: undefined }))
  api.editar.mock.mockImplementation(async () => ({ ok: true, dados: { aviso: null } }))
  for (const desmontar of montados.splice(0)) await desmontar()
})

const GRUPO = {
  id: 'g-1', nome: 'Grupo Exemplo', cnpj: '11.222.333/0001-81', ativo: true, blingClientId: null, blingClientSecret: null,
  mcpaiConfigurado: false, mcpaiResumo: null, razaoSocial: null, enderecoSede: null, cidadeSede: null, comarcaForo: null,
  mpConectado: true, mpFinal: '482',
}

async function montar(props: Omit<Props, 'open' | 'onOpenChange'>) {
  const { GrupoDialog } = await import('./grupo-dialog')
  const onOpenChange = mock.fn((_v: boolean) => {})
  const t = await montarDialogo(GrupoDialog, { open: true, onOpenChange, ...props })
  montados.push(t.desmontar)
  return { ...t, onOpenChange }
}
const fechou = (onOpenChange: ReturnType<typeof mock.fn>) => onOpenChange.mock.calls.some(c => c.arguments[0] === false)

test('Editar mostra só o final da conta e envia o token colado', async () => {
  const t = await montar({ modo: 'editar', inicial: GRUPO })
  assert.match(textoDaTela(), /Configurada: conta final 482/)
  await t.preencher('grupo-mp-token', 'APP_USR-novo-token-ficticio-0000000000')
  await t.clique('Salvar')
  assert.equal(api.editar.mock.callCount(), 1)
  const [id, dados] = api.editar.mock.calls[0].arguments
  assert.equal(id, 'g-1')
  assert.deepEqual([dados.mpToken, dados.mpRemover], ['APP_USR-novo-token-ficticio-0000000000', false])
  assert.ok(fechou(t.onOpenChange))
})

test('Editar com o campo vazio envia vazio (o servidor mantém a credencial)', async () => {
  const t = await montar({ modo: 'editar', inicial: GRUPO })
  await t.clique('Salvar')
  const [, dados] = api.editar.mock.calls[0].arguments
  assert.deepEqual([dados.mpToken, dados.mpRemover], ['', false])
})

test('Remover credencial avisa no título e envia mpRemover', async () => {
  const t = await montar({ modo: 'editar', inicial: GRUPO })
  await t.clique('Remover credencial')
  assert.match(textoDaTela(), /credencial do Mercado Pago será removida/)
  assert.match(textoDaTela(), /A credencial será apagada ao salvar/)
  await t.clique('Salvar')
  const [, dados] = api.editar.mock.calls[0].arguments
  assert.deepEqual([dados.mpToken, dados.mpRemover], ['', true])
})

test('grupo sem credencial: diz que a importação fica desligada', async () => {
  await montar({ modo: 'editar', inicial: { ...GRUPO, mpConectado: false, mpFinal: null } })
  assert.match(textoDaTela(), /Sem credencial, a importação do Mercado Pago fica desligada neste grupo/)
  assert.doesNotMatch(textoDaTela(), /Configurada: conta final/)
})

// #404: lançada, a frase virava "Minified React error #441" em produção.
test('recusa do servidor no Editar aparece no diálogo, que continua aberto', async () => {
  const frase = 'Esta credencial é de uma conta de teste do Mercado Pago. Aqui só entra a credencial da conta real da loja.'
  api.editar.mock.mockImplementation(async () => ({ ok: false, erro: frase }))
  const t = await montar({ modo: 'editar', inicial: GRUPO })
  await t.preencher('grupo-mp-token', 'APP_USR-conta-de-teste-ficticia-000000000')
  await t.clique('Salvar')
  // Recusa do Mercado Pago fica embaixo do campo dele (protótipo V1), ligada ao campo para o leitor de tela.
  const campo = document.getElementById('grupo-mp-token')!
  assert.equal(document.getElementById(campo.getAttribute('aria-describedby') ?? '')?.textContent, frase)
  assert.equal(campo.getAttribute('aria-invalid'), 'true')
  assert.equal(fechou(t.onOpenChange), false)
  assert.equal(toast.success.mock.callCount(), 0)
})

test('recusa do servidor no Novo Grupo também aparece, e o Novo Grupo não tem o campo do Mercado Pago', async () => {
  api.criar.mock.mockImplementation(async () => ({ ok: false, erro: 'Conta não encontrada' }))
  const t = await montar({ modo: 'criar', contas: [] })
  // Compara texto, nunca o nó: o assert tenta imprimir o nó do JSDOM e trava o arquivo em vez de falhar.
  assert.equal(document.getElementById('grupo-mp-token')?.outerHTML ?? null, null)
  await t.preencher('grupo-nome', 'Novo')
  await t.preencher('grupo-cnpj', '00.000.000/0001-91')
  await t.clique('Criar')
  assert.equal('mpToken' in api.criar.mock.calls[0].arguments[0], false)
  assert.equal(document.querySelector('[role="alert"]')?.textContent, 'Conta não encontrada')
  assert.equal(fechou(t.onOpenChange), false)
})

test('credencial gravada com aviso (CNPJ do titular diferente): salva e mostra o aviso', async () => {
  const aviso = 'Credencial salva, mas confira: a conta do Mercado Pago é de outro CNPJ, diferente do CNPJ deste grupo.'
  api.editar.mock.mockImplementation(async () => ({ ok: true, dados: { aviso } }))
  const t = await montar({ modo: 'editar', inicial: GRUPO })
  await t.preencher('grupo-mp-token', 'APP_USR-outro-cnpj-ficticio-0000000000')
  await t.clique('Salvar')
  assert.deepEqual(toast.warning.mock.calls.map(c => c.arguments[0]), [aviso])
  assert.ok(fechou(t.onOpenChange))
})

// O diálogo de editar é o mesmo componente entre aberturas (key = id do grupo): o que ficou de uma abertura
// não pode valer na seguinte.
test('depois de salvar com Remover, ao reabrir o campo volta livre e o título não fala em remoção', async () => {
  const t = await montar({ modo: 'editar', inicial: GRUPO })
  await t.clique('Remover credencial')
  await t.clique('Salvar')
  await t.redesenhar({ modo: 'editar', inicial: GRUPO, open: false, onOpenChange: t.onOpenChange })
  await t.redesenhar({ modo: 'editar', inicial: GRUPO, open: true, onOpenChange: t.onOpenChange })
  assert.equal((document.getElementById('grupo-mp-token') as HTMLInputElement).disabled, false)
  assert.doesNotMatch(textoDaTela(), /será removida/)
})

test('Cancelar depois de uma recusa: ao reabrir, sem a frase velha e o Salvar não reenvia o token abandonado', async () => {
  api.editar.mock.mockImplementation(async () => ({ ok: false, erro: 'O Mercado Pago recusou esse token. Confira se é o Access Token de produção da conta da loja.' }))
  const t = await montar({ modo: 'editar', inicial: GRUPO })
  await t.preencher('grupo-mp-token', 'APP_USR-token-abandonado-0000000000000')
  await t.preencher('grupo-mcpai', 'https://api.mcp.ai/abandonada')
  await t.clique('Salvar')
  assert.ok(document.querySelector('[role="alert"]'), 'a recusa devia aparecer')
  await t.clique('Cancelar')
  await t.redesenhar({ modo: 'editar', inicial: GRUPO, open: false, onOpenChange: t.onOpenChange })
  await t.redesenhar({ modo: 'editar', inicial: GRUPO, open: true, onOpenChange: t.onOpenChange })
  assert.equal(document.querySelector('[role="alert"]')?.textContent ?? null, null)
  api.editar.mock.mockImplementation(async () => ({ ok: true, dados: { aviso: null } }))
  await t.clique('Salvar')
  const [, dados] = api.editar.mock.calls.at(-1)!.arguments
  assert.deepEqual([dados.mpToken, dados.mpRemover, dados.mcpaiEndpointUrl, dados.mcpaiRemover], ['', false, '', false])
})

// Recusa do MP fica embaixo do campo, dentro de Integrações: recolhida, a frase sumiria (#578).
test('recusa do Mercado Pago com Integrações recolhida: a seção abre e a frase aparece', async () => {
  api.editar.mock.mockImplementation(async () => ({ ok: false, erro: FRASES_MP.recusado }))
  const t = await montar({ modo: 'editar', inicial: { ...GRUPO, mpConectado: false, mpFinal: null } })
  assert.equal(document.querySelector('details')?.open, false)
  await t.preencher('grupo-mp-token', 'APP_USR-recolhido-ficticio-000000000000')
  await t.clique('Salvar')
  assert.equal(document.querySelector('details')?.open, true)
  assert.equal(document.getElementById('grupo-mp-token-erro')?.textContent ?? null, FRASES_MP.recusado)
})
