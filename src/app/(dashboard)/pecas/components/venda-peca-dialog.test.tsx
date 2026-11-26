// Diálogo "Nova venda de peças" (#308): o campo Responsável. Quem pode escolher vê o campo já com o próprio
// nome, escolhe outra pessoa da lista (com a loja dela) e a action recebe o id; quem não pode não vê o campo
// e não envia nada. A edição não muda o responsável. As actions são a fronteira de fora; o resto roda de verdade.
import test, { after, afterEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import { montarDom } from '@/test/montar-dom'
import { digitar } from '@/test/eventos-dom'
import { botao, clicar, esperar, montarDialogo, textoDaTela } from '@/test/dialogo-em-tela'

const { desmontar: desmontarDom } = montarDom()

type Resposta = { ok: true; dados: { aguardandoAprovacao: boolean; id?: string } } | { ok: false; erro: string }
const registrar = mock.fn(async (_pedido: unknown): Promise<Resposta> => ({ ok: true, dados: { aguardandoAprovacao: false, id: 'v-1' } }))
const editar = mock.fn(async (_id: string, _pedido: unknown): Promise<Resposta> => ({ ok: true, dados: { aguardandoAprovacao: false } }))
const carregar = mock.fn(async (_id: string) => ({
  ok: true as const,
  dados: {
    clienteNome: 'Cliente sintético', lojaId: 'l-centro',
    itens: [{ pecaId: 'p-1', quantidade: 1, valorUnitario: 50 }],
    pecas: [{ id: 'p-1', nome: 'Retrovisor', valor: '50.00', quantidadeEstoque: 5 }],
    pagamentos: [{ tipo: 'pix', valor: 50 }],
    avisos: [] as string[],
  },
}))
const mocks = [
  mock.module('../actions', { namedExports: {
    registrarVendaPecaAction: (pedido: unknown) => registrar(pedido),
    editarVendaPecaAction: (id: string, pedido: unknown) => editar(id, pedido),
    carregarVendaPecaParaEdicaoAction: (id: string) => carregar(id),
  } }),
  mock.module('@/components/use-maquininhas', { namedExports: { useMaquininhas: () => [] } }),
  mock.module('sonner', { namedExports: { toast: { success: () => {}, error: () => {} } } }),
]

const montados: (() => Promise<void>)[] = []
afterEach(async () => {
  registrar.mock.resetCalls()
  editar.mock.resetCalls()
  carregar.mock.resetCalls()
  for (const desmontar of montados.splice(0)) await desmontar()
})
after(() => { for (const m of mocks) m.restore(); desmontarDom() })

const PECAS = [{ id: 'p-1', nome: 'Retrovisor', valor: '50.00', quantidadeEstoque: 5 }]
const LOJAS = [{ id: 'l-centro', nome: 'Loja Centro' }]
const RESPONSAVEIS = [
  { id: 'u-aux', nome: 'Marina Alves', lojaNome: 'Loja Centro' },
  { id: 'u-bruno', nome: 'Bruno Nogueira', lojaNome: 'Loja Norte' },
  { id: 'u-socio', nome: 'Rafael Teixeira', lojaNome: null },
]

async function montar(props: Record<string, unknown> = {}) {
  const { VendaPecaDialog } = await import('./venda-peca-dialog')
  const t = await montarDialogo(VendaPecaDialog as never, {
    pecas: PECAS, lojas: LOJAS, lojaUsuarioId: 'l-centro', isAdmin: false, podeDefinirPreco: false, ...props,
  } as never)
  montados.push(t.desmontar)
  return t
}

const rotulo = (texto: RegExp) => [...document.querySelectorAll('label')].find(l => texto.test(l.textContent ?? ''))
const campoResponsavel = () => rotulo(/^Responsável$/)?.parentElement?.querySelector('[data-slot="select-trigger"]') as HTMLElement | null | undefined
// O item do base-ui só aceita o clique que começou nele: o pressionar vem antes, como no navegador.
function clicarNaOpcao(comeco: string) {
  const opcao = [...document.querySelectorAll('[role="option"]')].find(o => (o.textContent ?? '').startsWith(comeco))
  assert.ok(opcao, `opção ${comeco} não encontrada`)
  opcao.dispatchEvent(new window.Event('pointerdown', { bubbles: true }))
  clicar(opcao)
}
const opcoes = () => [...document.querySelectorAll('[role="option"]')].map(o => (o.textContent ?? '').trim())

async function preencherEConfirmar(t: Awaited<ReturnType<typeof montar>>) {
  await t.act(async () => { clicar(botao('Nova venda')); await esperar(50) })
  await digitar(document.querySelector('input[placeholder="Digite o nome da peça…"]') as HTMLInputElement, 'Retrov')
  await t.act(async () => { clicar([...document.querySelectorAll('button')].find(b => (b.textContent ?? '').includes('Retrovisor'))); await esperar(20) })
  await digitar(document.querySelector('input[placeholder="0,00"]') as HTMLInputElement, '50,00')
  await t.act(async () => { clicar(botao('Registrar Venda')); await esperar(50) })
}

test('quem pode escolher vê o campo com o próprio nome e "(você)", e envia o próprio id se não mexer', async () => {
  const t = await montar({ responsaveis: RESPONSAVEIS, usuarioId: 'u-aux' })
  await t.act(async () => { clicar(botao('Nova venda')); await esperar(50) })
  assert.match(campoResponsavel()?.textContent ?? '', /^Marina Alves \(você\)/)
  await t.clique('Cancelar', 300)
  await preencherEConfirmar(t)
  assert.equal(registrar.mock.calls.length, 1)
  assert.equal((registrar.mock.calls[0].arguments[0] as { vendedorId?: string }).vendedorId, 'u-aux')
})

test('a lista traz as pessoas com a loja de cada uma, e escolher outra pessoa mostra o nome dela no campo', async () => {
  const t = await montar({ responsaveis: RESPONSAVEIS, usuarioId: 'u-aux' })
  await t.act(async () => { clicar(botao('Nova venda')); await esperar(50) })
  await t.act(async () => { clicar(campoResponsavel()); await esperar(30) })
  assert.deepEqual(opcoes(), ['Marina Alves (você)Loja Centro', 'Bruno NogueiraLoja Norte', 'Rafael Teixeirasem loja'])
  await t.act(async () => { clicarNaOpcao('Bruno Nogueira'); await esperar(30) })
  assert.match(campoResponsavel()?.textContent ?? '', /^Bruno Nogueira(?! \(você\))/)
})

test('escolher outra pessoa e registrar: a action recebe o id escolhido', async () => {
  const t = await montar({ responsaveis: RESPONSAVEIS, usuarioId: 'u-aux' })
  await t.act(async () => { clicar(botao('Nova venda')); await esperar(50) })
  await t.act(async () => { clicar(campoResponsavel()); await esperar(30) })
  await t.act(async () => { clicarNaOpcao('Bruno Nogueira'); await esperar(30) })
  await digitar(document.querySelector('input[placeholder="Digite o nome da peça…"]') as HTMLInputElement, 'Retrov')
  await t.act(async () => { clicar([...document.querySelectorAll('button')].find(b => (b.textContent ?? '').includes('Retrovisor'))); await esperar(20) })
  await digitar(document.querySelector('input[placeholder="0,00"]') as HTMLInputElement, '50,00')
  await t.act(async () => { clicar(botao('Registrar Venda')); await esperar(50) })
  assert.equal(registrar.mock.calls.length, 1)
  assert.equal((registrar.mock.calls[0].arguments[0] as { vendedorId?: string }).vendedorId, 'u-bruno')
})

test('quem não pode escolher (sem a lista) não vê o campo e não envia vendedorId', async () => {
  const t = await montar({ usuarioId: 'u-vendedor' })
  await t.act(async () => { clicar(botao('Nova venda')); await esperar(50) })
  assert.equal(rotulo(/^Responsável$/), undefined)
  assert.doesNotMatch(textoDaTela(), /Responsável/)
  await t.clique('Cancelar', 300)
  await preencherEConfirmar(t)
  assert.equal(registrar.mock.calls.length, 1)
  assert.equal('vendedorId' in (registrar.mock.calls[0].arguments[0] as object), false)
})

test('depois de registrar, o diálogo volta ao próprio nome na venda seguinte', async () => {
  const t = await montar({ responsaveis: RESPONSAVEIS, usuarioId: 'u-aux' })
  await t.act(async () => { clicar(botao('Nova venda')); await esperar(50) })
  await t.act(async () => { clicar(campoResponsavel()); await esperar(30) })
  await t.act(async () => { clicarNaOpcao('Bruno Nogueira'); await esperar(30) })
  await t.clique('Cancelar', 300)
  await t.act(async () => { clicar(botao('Nova venda')); await esperar(50) })
  assert.match(campoResponsavel()?.textContent ?? '', /^Marina Alves \(você\)/)
})

test('editar uma venda não mostra o campo e envia só itens e pagamentos', async () => {
  const t = await montar({ responsaveis: RESPONSAVEIS, usuarioId: 'u-aux', edicao: { vendaId: 'v-9', numero: 9 } })
  await t.act(async () => { clicar(botao('Editar')); await esperar(80) })
  assert.doesNotMatch(textoDaTela(), /Responsável/)
  await t.act(async () => { clicar(botao('Salvar alterações')); await esperar(50) })
  assert.equal(editar.mock.calls.length, 1)
  assert.deepEqual(Object.keys(editar.mock.calls[0].arguments[1] as object).sort(), ['itens', 'pagamentos'])
})
