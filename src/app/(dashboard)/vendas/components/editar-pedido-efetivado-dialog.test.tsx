// Editar venda de pedido (#25, 25d; protótipos V2 e 25d): o pedido vem da leitura do servidor (23b/25d1) e a gravação vai inteira ao
// editarPedidoEfetivadoAction. As Server Actions são a fronteira de fora; o que se confere é o que a tela mostra e o que ela envia.
import { createElement } from 'react'
import test, { after, afterEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import { montarDom } from '@/test/montar-dom'
import { clicar, digitar } from '@/test/eventos-dom'
import { entregarSintetico } from '@/test/entrega-sintetica'

const { desmontar: desmontarDom } = montarDom()

const SEM_TAXA = { taxasCartao: {}, taxasDebito: {}, taxasLink: {}, taxasFinanciamento: {} }
const moto = (id: string, modelo: string, final: string, valor: string, minimo: number | null) =>
  ({ id, chassi: `9C2LA000000${final}`, marca: 'MC', modelo, cor: 'PRETA', lojaId: 'l1', lojaNome: 'Loja Centro', valor, minimo })
const PEDIDO = {
  lojaId: 'loja-do-pedido', numero: 32140, taxas: SEM_TAXA, frete: 180, entrega: entregarSintetico(180), notaQueTrava: null as null | { numero: string; por: 'nota' | 'papel' },
  motos: [moto('m1', 'JET', '4131', '9490.00', 8990), moto('m2', 'PITICA', '0088', '5200.00', 5490)],
  pecas: [
    { tipo: 'acessorio' as const, pecaId: 'c1', nome: 'Capacete fechado', quantidade: 1, valor: '290.00' },
    { tipo: 'brinde' as const, pecaId: 'b1', nome: 'Baú traseiro', quantidade: 1, valor: '0.00' },
  ],
  pagamentos: [{ tipo: 'pix', valor: 8000 }, { tipo: 'dinheiro', valor: 7160 }],
  comprador: { clienteNome: 'Ana Beatriz Moreira', clienteCpf: '529.982.247-25' },
  dataVenda: '2026-11-18', vendedorId: 'v1', origemId: 'o1', origemDetalhe: null,
}
let leitura: () => Promise<unknown> = async () => ({ ok: true, dados: PEDIDO })
const enviados: unknown[][] = []
let respostaDoSalvar: () => Promise<unknown> = async () => ({ ok: true, dados: undefined })
const actionsMock = mock.module('../actions', { namedExports: {
  pedidoEfetivadoAction: () => leitura(),
  editarPedidoEfetivadoAction: async (...a: unknown[]) => { enviados.push(a); return respostaDoSalvar() },
} })
const lojasDasMaquininhas: unknown[] = []
const maquininhasMock = mock.module('@/app/(dashboard)/maquininhas-actions', { namedExports: { maquininhasDoRegistroAction: async (r: unknown) => { lojasDasMaquininhas.push(r); return [] } } })

const montados: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const desmontar of montados.splice(0)) await desmontar()
  enviados.length = 0; lojasDasMaquininhas.length = 0
  leitura = async () => ({ ok: true, dados: PEDIDO }); respostaDoSalvar = async () => ({ ok: true, dados: undefined })
})
after(() => { actionsMock.restore(); maquininhasMock.restore(); desmontarDom() })

const ORIGENS = [{ id: 'o1', nome: 'Indicação', tipo: 'outro', pedeDetalhe: false }]
const VENDEDORES = [{ id: 'v1', nome: 'Carlos Lima' }, { id: 'v2', nome: 'Mariana Alves' }]
const texto = () => document.body.textContent ?? ''
const recibo = () => document.querySelector('[aria-label="Itens do pedido"]')?.textContent ?? ''
const botao = (t: string) => [...document.querySelectorAll('button')].find(b => b.textContent?.trim() === t) as HTMLButtonElement | undefined
const rotulo = (r: string) => document.querySelector<HTMLElement>(`[aria-label="${r}"]`)
const campo = (id: string) => document.getElementById(id) as HTMLInputElement

async function abrir(papel = 'admin_socio', pedido: unknown = PEDIDO, lerPedido: () => Promise<unknown> = async () => ({ ok: true, dados: pedido })) {
  leitura = lerPedido
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { EditarPedidoEfetivadoDialog } = await import('./editar-pedido-efetivado-dialog')
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(createElement(EditarPedidoEfetivadoDialog, {
      vendaId: 'venda-1', papel, vendedores: VENDEDORES, origens: ORIGENS,
      gatilho: (abrirDialogo: () => void) => createElement('button', { type: 'button', onClick: abrirDialogo }, 'Editar'),
    }))
  })
  montados.push(() => act(async () => { root.unmount(); container.remove() }))
  await clicar(botao('Editar'))
}

test('T1: abre com o pedido: título, itens no recibo (antes do cliente no DOM), cliente, venda, pagamentos e "Pago por completo"', async () => {
  await abrir()
  assert.match(texto(), /Editar venda do pedido 32140/)
  assert.match(texto(), /Venda efetivada, sem nota fiscal valendo\. Loja Centro\./)
  for (const item of [/MC JET/, /MC PITICA/, /Capacete fechado/, /Baú traseiro/, /Frete/]) assert.match(recibo(), item)
  assert.equal(campo('editar-cliente-nome').value, 'Ana Beatriz Moreira')
  assert.match(texto(), /O mesmo cliente para as 2 motos\. Contato e endereço seguem como estão no cadastro da venda\./)
  assert.equal(campo('editar-data').value, '2026-11-18')
  assert.equal((document.getElementById('editar-vendedor') as HTMLSelectElement).value, 'v1')
  assert.match(texto(), /Pago por completo/)
  assert.match(rotulo('Total do pedido')!.textContent ?? '', /R\$\s*15\.160,00/)
  const ordem = rotulo('Itens do pedido')!.compareDocumentPosition(campo('editar-cliente-nome'))
  assert.ok(ordem & Node.DOCUMENT_POSITION_FOLLOWING, 'no celular o recibo vem primeiro')
  assert.equal(botao('Salvar alterações')!.disabled, false)
})

test('T2: sem NF, o sócio altera o valor de uma moto e do acessório e acerta o pagamento; Salvar envia o pedido inteiro', async () => {
  await abrir()
  await clicar(rotulo('Alterar valor da MC PITICA'))
  await digitar(rotulo('Valor da MC PITICA') as HTMLInputElement, '510000')
  await clicar(rotulo('Alterar valor do Capacete fechado'))
  await digitar(rotulo('Valor de cada Capacete fechado') as HTMLInputElement, '20000')
  assert.match(texto(), /Passou R\$\s*190,00 do total/)
  assert.equal(botao('Salvar alterações')!.disabled, true)
  await digitar(rotulo('Valor da forma 1') as HTMLInputElement, '781000')
  assert.match(texto(), /Pago por completo/)
  await clicar(botao('Salvar alterações'))
  assert.deepEqual(enviados, [['venda-1', {
    clienteNome: 'Ana Beatriz Moreira', clienteCpf: '529.982.247-25', dataVenda: '2026-11-18', vendedorId: 'v1', origemId: 'o1', origemDetalhe: undefined,
    pagamentos: [{ tipo: 'pix', valor: 7810 }, { tipo: 'dinheiro', valor: 7160 }],
    motos: [{ motoId: 'm1', valor: 9490 }, { motoId: 'm2', valor: 5100 }], acessorios: [{ pecaId: 'c1', valor: 200 }],
  }]])
})

test('T3: sem NF, o aux_adm vê os valores sem "Alterar"; cliente e venda seguem editáveis', async () => {
  await abrir('aux_adm')
  assert.equal(rotulo('Alterar valor da MC JET'), null)
  assert.equal(rotulo('Alterar valor do Capacete fechado'), null)
  assert.equal(campo('editar-cliente-nome').readOnly, false)
  assert.doesNotMatch(recibo(), /Na nota/)
})

test('T4a: NF valendo: aviso com o número, cliente só leitura, itens, frete e Entrega "Na nota"; o pagamento muda e vai com os valores gravados', async () => {
  await abrir('aux_adm', { ...PEDIDO, notaQueTrava: { numero: '27', por: 'nota' } })
  assert.match(texto(), /A nota fiscal nº 27 está valendo\. Itens, valores e cliente estão nela e não mudam\. Para mudar, cancele a nota antes\. Dá para corrigir o pagamento\./)
  assert.match(texto(), /com a nota fiscal valendo/)
  assert.equal(campo('editar-cliente-nome').readOnly, true)
  assert.equal(campo('editar-cliente-cpf').readOnly, true)
  assert.equal((recibo().match(/Na nota/g) ?? []).length, 4)
  assert.match(rotulo('Entrega do pedido')!.textContent ?? '', /Na nota/)
  await digitar(rotulo('Valor da forma 1') as HTMLInputElement, '700000')
  await digitar(rotulo('Valor da forma 2') as HTMLInputElement, '816000')
  await clicar(botao('Salvar alterações'))
  const [[, enviado]] = enviados as [string, { motos: unknown; acessorios: unknown; clienteNome: string; pagamentos: unknown }][]
  assert.deepEqual([enviado.clienteNome, enviado.motos, enviado.acessorios, enviado.pagamentos], ['Ana Beatriz Moreira',
    [{ motoId: 'm1', valor: 9490 }, { motoId: 'm2', valor: 5200 }], [{ pecaId: 'c1', valor: 290 }], [{ tipo: 'pix', valor: 7000 }, { tipo: 'dinheiro', valor: 8160 }]])
})

test('T4b: trava pelo nº de NF do aux_adm (Bling): a frase do papel, cliente só leitura, valores fixos sem "Na nota"', async () => {
  await abrir('aux_adm', { ...PEDIDO, notaQueTrava: { numero: '4321', por: 'papel' } })
  assert.match(texto(), /Esta venda tem NF registrada \(nº 4321\)\. Cliente e valores só mudam com os administradores\. Dá para corrigir o pagamento\./)
  assert.equal(campo('editar-cliente-nome').readOnly, true)
  assert.doesNotMatch(recibo(), /Na nota/)
  assert.equal(rotulo('Alterar valor da MC JET'), null)
})

test('T5: a recusa do servidor fica no diálogo, que segue aberto', async () => {
  respostaDoSalvar = async () => ({ ok: false, erro: 'A nota fiscal nº 27 está valendo.' })
  await abrir()
  await clicar(botao('Salvar alterações'))
  assert.match(document.querySelector('[role="alert"]')?.textContent ?? '', /A nota fiscal nº 27 está valendo\./)
  assert.ok(botao('Salvar alterações'))
})

test('T6: enquanto salva, os botões travam e o Escape não fecha; ao responder, fecha', async () => {
  let responder: (r: unknown) => void = () => {}
  respostaDoSalvar = () => new Promise(r => { responder = r })
  await abrir()
  await clicar(botao('Salvar alterações'))
  assert.equal(botao('Salvando...')!.disabled, true)
  assert.equal(botao('Cancelar')!.disabled, true)
  const { act } = await import('react')
  await act(async () => { document.querySelector('[data-slot="dialog-content"]')!.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
  assert.ok(botao('Salvando...'), 'o Escape não fechou')
  await act(async () => { responder({ ok: true, dados: undefined }); await new Promise(r => setTimeout(r, 350)) })
  assert.equal(botao('Salvar alterações'), undefined)
})

test('T9: carregando, só o aviso e o Salvar travado; leitura que falha mostra o motivo e segue travado', async () => {
  let carregar: (r: unknown) => void = () => {}
  await abrir('admin_socio', PEDIDO, () => new Promise(r => { carregar = r }))
  assert.match(texto(), /Carregando os itens do pedido\.\.\./)
  assert.equal(botao('Salvar alterações')!.disabled, true)
  const { act } = await import('react')
  await act(async () => { carregar({ ok: false, erro: 'Venda não encontrada' }) })
  assert.match(document.querySelector('[role="alert"]')?.textContent ?? '', /Não deu para carregar o pedido: Venda não encontrada/)
  assert.equal(botao('Salvar alterações')!.disabled, true)
})

test('T11: as maquininhas vêm da loja do pedido, a que o servidor confere', async () => {
  await abrir()
  assert.deepEqual(lojasDasMaquininhas, [{ loja: 'loja-do-pedido' }])
})
