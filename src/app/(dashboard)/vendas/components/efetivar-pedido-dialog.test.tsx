// Efetivar o pedido (#25, V2): os itens vêm do pedido (action do 25a1), o cliente e as formas de pagamento se digitam aqui.
// A tela decide selo, barra e aprovação pelas mesmas funções do servidor. As Server Actions são a fronteira de fora.
import { createElement } from 'react'
import test, { after, afterEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import { montarDom } from '@/test/montar-dom'
import { clicar, digitar, digitarTexto, escolher, escolherOpcao } from '@/test/eventos-dom'
import type { EntregaVenda } from '@/lib/notagateway/entrega'

const { desmontar: desmontarDom } = montarDom()
after(desmontarDom)

const SEM_TAXA = { taxasCartao: {}, taxasDebito: {}, taxasLink: {}, taxasFinanciamento: {} }
const moto = (id: string, modelo: string, final: string, valor: string, minimo: number | null = null) =>
  ({ id, chassi: `9C2LA000000${final}`, marca: 'MC', modelo, cor: 'PRETA', lojaId: 'l1', lojaNome: 'Loja Centro', valor, minimo })
const JET = moto('m1', 'JET', '4131', '9490.00', 8990)
const PITICA = moto('m2', 'PITICA', '0088', '5200.00', 5000)
const PECAS = [
  { tipo: 'acessorio', pecaId: 'c1', nome: 'Capacete fechado', quantidade: 1, valor: '290.00' },
  { tipo: 'brinde', pecaId: 'b1', nome: 'Baú traseiro', quantidade: 1, valor: '0.00' },
]
let itens: unknown = { lojaId: 'loja-do-pedido', motos: [JET], pecas: [], taxas: SEM_TAXA }
let respostaDosItens: () => Promise<unknown> = async () => ({ ok: true, dados: itens })
const enviados: unknown[][] = []
let respostaDoEfetivar: () => Promise<unknown> = async () => ({ ok: true, dados: undefined })
const alteracoes: unknown[][] = []
let respostaDoAlterar: { ok: true; dados: undefined } | { ok: false; erro: string } = { ok: true, dados: undefined }
let respostaDoAlterarFn: () => Promise<unknown> = async () => respostaDoAlterar
mock.module('../actions', { namedExports: {
  efetivarVendaAction: async (...a: unknown[]) => { enviados.push(a); return respostaDoEfetivar() },
  alterarEntregaDoPedidoAction: async (...a: unknown[]) => { alteracoes.push(a); return respostaDoAlterarFn() },
  itensDoPedidoAction: () => respostaDosItens(),
} })
const lojasDasMaquininhas: unknown[] = []
mock.module('@/app/(dashboard)/maquininhas-actions', { namedExports: { maquininhasDoRegistroAction: async (r: unknown) => { lojasDasMaquininhas.push(r); return [] } } })
mock.module('@/app/(dashboard)/clientes/actions', { namedExports: {
  buscarClientesAction: async () => [], criarClienteAction: async () => ({ ok: true, dados: undefined }),
} })

const montados: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const desmontar of montados.splice(0)) await desmontar()
  enviados.length = 0; alteracoes.length = 0; respostaDoEfetivar = async () => ({ ok: true, dados: undefined })
  itens = { lojaId: 'loja-do-pedido', motos: [JET], pecas: [], taxas: SEM_TAXA }; lojasDasMaquininhas.length = 0; respostaDosItens = async () => ({ ok: true, dados: itens })
  respostaDoAlterar = { ok: true, dados: undefined }; respostaDoAlterarFn = async () => respostaDoAlterar
})

const ORIGEM = [{ id: 'o1', nome: 'Passou na porta', tipo: 'outro', pedeDetalhe: false }]
const texto = () => document.body.textContent ?? ''
const entregaNaTela = () => document.querySelector('[aria-label="Entrega do pedido"]')?.textContent ?? ''
const reciboNaTela = () => document.querySelector('[aria-label="Itens do pedido"]')?.textContent ?? ''
const totalNaTela = () => document.querySelector('[aria-label="Total do pedido"]')?.textContent ?? ''
const botao = (t: string) => [...document.querySelectorAll('button')].find(b => b.textContent?.trim() === t) as HTMLButtonElement | undefined
const alterarEntrega = () => document.querySelector('[aria-label="Entrega do pedido"] button')
const campo = (rotulo: string) => document.querySelector<HTMLInputElement>(`[aria-label="${rotulo}"]`)!

async function abrir(entrega: EntregaVenda | null, quem = { papel: 'aux_adm', podeAprovarSensivel: false }) {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { EfetivarPedidoDialog } = await import('./efetivar-pedido-dialog')
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  const props = (e: EntregaVenda | null) => ({ pedidoId: 'p1', numero: 32140, origens: ORIGEM, entrega: e, ...quem })
  await act(async () => { root.render(createElement(EfetivarPedidoDialog, props(entrega))) })
  montados.push(() => act(async () => { root.unmount(); container.remove() }))
  await clicar(botao('Efetivar Venda'))
  // A página recarregada passa o pedido de novo, com outra Entrega.
  return (nova: EntregaVenda | null) => act(async () => { root.render(createElement(EfetivarPedidoDialog, props(nova))) })
}

async function preencherCliente() {
  const doRotulo = (r: RegExp) => [...document.querySelectorAll('label')].find(l => r.test(l.textContent ?? ''))!.parentElement!.querySelector('input')!
  await digitar(doRotulo(/^Nome completo/), 'Cliente sintético')
  await digitar(doRotulo(/^CPF\/CNPJ/), '52998224725')
  await escolher(document.querySelector('select')!, 'o1')
}

/** Escolhe a forma da próxima linha vazia e digita o valor (em centavos, como no campo de dinheiro). */
async function pagar(forma: string, centavos: string, linha: number) {
  if (linha > 1) await clicar(botao('Adicionar forma de pagamento'))
  await escolherOpcao([...document.querySelectorAll('button, [role="combobox"]')].find(b => /^Forma de pagamento/.test(b.textContent?.trim() ?? '')), forma)
  await digitar(campo(`Valor da forma ${linha}`), centavos)
}

test('2 motos, acessório, brinde e frete: o recibo mostra cada item e o total; pagar em 2 formas fecha, mostra o selo e envia a lista', async () => {
  itens = { lojaId: 'loja-do-pedido', motos: [JET, PITICA], pecas: PECAS, taxas: SEM_TAXA }
  await abrir({ ...ENTREGAR, frete: 180 } as EntregaVenda)
  assert.match(texto(), /Efetivar pedido 32140/)
  const recibo = reciboNaTela()
  for (const linha of [/MC JET/, /Chassi final 4131, preta/, /Mínimo R\$\s*8\.990,00/, /MC PITICA/, /Capacete fechado/, /Acessório, 1 unidade/, /Baú traseiro/, /Brinde, sem cobrança/, /Frete/]) assert.match(recibo, linha)
  assert.match(totalNaTela(), /R\$\s*15\.160,00/)
  assert.doesNotMatch(recibo, /No mínimo/, 'sem o pagamento fechado o líquido ainda não é o da venda')
  assert.match(texto(), /Falta pagar R\$\s*15\.160,00/)
  await preencherCliente()
  await pagar('PIX', '800000', 1)
  const formas = () => [...document.querySelectorAll('[role="combobox"]')].map(c => c.textContent?.replace('▼', '').trim())
  assert.deepEqual(formas(), ['PIX'], 'a forma escolhida aparece pelo nome, não pelo código')
  assert.match(texto(), /Falta pagar R\$\s*7\.160,00/)
  assert.equal(botao('Confirmar venda')?.disabled, true)
  await pagar('Dinheiro', '716000', 2)
  assert.match(texto(), /Pago por completo/)
  assert.equal(reciboNaTela().match(/No mínimo/g)?.length, 2)
  await clicar(botao('Confirmar venda'))
  assert.equal(enviados.length, 1)
  assert.deepEqual(enviados[0].slice(0, 5), ['p1', 'Cliente sintético', '529.982.247-25',
    [{ motoId: 'm1', valor: 9490 }, { motoId: 'm2', valor: 5200 }], [{ tipo: 'pix', valor: 8000 }, { tipo: 'dinheiro', valor: 7160 }]])
})

test('pagamento que passa do total: a barra diz quanto passou e o botão fica travado', async () => {
  await abrir(ENTREGAR)
  await preencherCliente()
  await pagar('PIX', '1000000', 1)
  assert.match(texto(), /Passou R\$\s*510,00 do total/)
  assert.equal(botao('Confirmar venda')?.disabled, true)
})

test('uma moto abaixo do mínimo: selo, aviso com a moto, motivo obrigatório e o motivo vai junto ao pedir aprovação', async () => {
  itens = { lojaId: 'loja-do-pedido', motos: [JET, { ...PITICA, minimo: 5490 }], pecas: [], taxas: SEM_TAXA }
  await abrir(ENTREGAR)
  await preencherCliente()
  await pagar('PIX', '1469000', 1)
  assert.match(reciboNaTela(), /Abaixo do mínimo/)
  const aviso = document.querySelector('[role="status"]')?.textContent ?? ''
  assert.match(aviso, /O pedido inteiro vai para aprovação/)
  assert.match(aviso, /MC PITICA: líquido R\$\s*5\.200,00, mínimo R\$\s*5\.490,00/)
  assert.doesNotMatch(aviso, /MC JET/)
  assert.equal(botao('Pedir aprovação')?.disabled, true)
  await digitarTexto(document.querySelector('#efetivar-motivo') as HTMLTextAreaElement, 'Cliente fiel')
  await clicar(botao('Pedir aprovação'))
  assert.equal(enviados[0][8], 'Cliente fiel')
})

test('com frete, a moto no mínimo não pede aprovação (o frete não conta); 1 real abaixo na moto, mesmo com o frete, pede', async () => {
  itens = { lojaId: 'loja-do-pedido', motos: [{ ...JET, minimo: 9490 }], pecas: [], taxas: SEM_TAXA }
  await abrir({ ...ENTREGAR, frete: 180 } as EntregaVenda)
  await preencherCliente()
  await pagar('PIX', '967000', 1)
  assert.match(reciboNaTela(), /No mínimo/)
  assert.equal(document.querySelector('[role="status"]'), null)
  assert.equal(botao('Confirmar venda')?.disabled, false)
  await clicar(campo('Alterar valor da MC JET'))
  await digitar(campo('Valor da MC JET'), '948900')
  await digitar(campo('Valor da forma 1'), '966900')
  assert.match(document.querySelector('[role="status"]')?.textContent ?? '', /MC JET: líquido R\$\s*9\.489,00, mínimo R\$\s*9\.490,00/)
})

test('sócio abaixo do mínimo vê o selo e efetiva direto, como no servidor', async () => {
  itens = { lojaId: 'loja-do-pedido', motos: [{ ...JET, minimo: 12000 }], pecas: [], taxas: SEM_TAXA }
  await abrir(ENTREGAR, { papel: 'admin_socio', podeAprovarSensivel: false })
  await preencherCliente()
  await pagar('PIX', '949000', 1)
  assert.match(reciboNaTela(), /Abaixo do mínimo/)
  assert.equal(document.querySelector('[role="status"]'), null)
  assert.equal(botao('Confirmar venda')?.disabled, false)
})

test('transferência sem a permissão pede aprovação sem exigir motivo; com a permissão, efetiva', async () => {
  await abrir(ENTREGAR)
  await preencherCliente()
  await pagar('Transferência Bancária', '949000', 1)
  assert.match(document.querySelector('[role="status"]')?.textContent ?? '', /Transferência bancária precisa de aprovação/)
  assert.equal(botao('Pedir aprovação')?.disabled, false)
  for (const d of montados.splice(0)) await d()
  await abrir(ENTREGAR, { papel: 'aux_adm', podeAprovarSensivel: true })
  await preencherCliente()
  await pagar('Transferência Bancária', '949000', 1)
  assert.equal(document.querySelector('[role="status"]'), null)
  assert.equal(botao('Confirmar venda')?.disabled, false)
})

test('moto sem valor já abre o campo e trava; "Alterar" muda o valor de outra; o total e o envio seguem os valores novos', async () => {
  itens = { lojaId: 'loja-do-pedido', motos: [{ ...JET, valor: '' }, PITICA], pecas: [], taxas: SEM_TAXA }
  await abrir(ENTREGAR)
  await preencherCliente()
  assert.ok(campo('Valor da MC JET'), 'a moto sem valor abre o campo')
  assert.match(totalNaTela(), /R\$\s*5\.200,00/)
  await digitar(campo('Valor da MC JET'), '950000')
  await clicar(campo('Alterar valor da MC PITICA'))
  await digitar(campo('Valor da MC PITICA'), '510000')
  assert.match(totalNaTela(), /R\$\s*14\.600,00/)
  await pagar('PIX', '1460000', 1)
  await clicar(botao('Confirmar venda'))
  assert.deepEqual(enviados[0][3], [{ motoId: 'm1', valor: 9500 }, { motoId: 'm2', valor: 5100 }])
})

test('os itens ainda carregando travam o botão; erro ao carregar aparece com o motivo', async () => {
  let chegar: (v: unknown) => void = () => {}
  respostaDosItens = () => new Promise(r => { chegar = r })
  await abrir(ENTREGAR)
  assert.match(texto(), /Carregando os itens do pedido/)
  assert.equal(botao('Confirmar venda')?.disabled, true)
  const { act } = await import('react')
  await act(async () => { chegar({ ok: false, erro: 'Pedido não encontrado' }) })
  assert.match(document.querySelector('[role="alert"]')?.textContent ?? '', /Não deu para carregar os itens do pedido: Pedido não encontrado/)
  assert.equal(botao('Confirmar venda')?.disabled, true)
})

test('enquanto efetiva: Confirmar e Cancelar travados e Escape não fecha; ao responder, fecha', async () => {
  let responder!: () => void
  respostaDoEfetivar = () => new Promise(r => { responder = () => r({ ok: true, dados: undefined }) })
  await abrir(ENTREGAR)
  await preencherCliente()
  await pagar('PIX', '949000', 1)
  await clicar(botao('Confirmar venda'))
  assert.equal(botao('Enviando...')?.disabled, true)
  assert.equal(botao('Cancelar')?.disabled, true)
  const { act } = await import('react')
  await act(async () => { document.activeElement?.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
  assert.match(texto(), /Efetivar pedido 32140/, 'Escape não fecha enquanto envia')
  await act(async () => { responder() })
  assert.doesNotMatch(texto(), /Efetivar pedido 32140/)
})

test('grupo sem taxas cadastradas: sem mínimo nem selo, e a venda segue', async () => {
  itens = { lojaId: 'loja-do-pedido', motos: [{ ...JET, minimo: null }], pecas: [], taxas: null }
  await abrir(ENTREGAR)
  await preencherCliente()
  await pagar('PIX', '949000', 1)
  assert.doesNotMatch(reciboNaTela(), /Mínimo|No mínimo|Abaixo do mínimo/)
  assert.equal(botao('Confirmar venda')?.disabled, false)
})

test('as maquininhas vêm da loja do pedido, a que o servidor confere, não da loja da 1ª moto', async () => {
  await abrir(ENTREGAR)
  assert.deepEqual(lojasDasMaquininhas, [{ loja: 'loja-do-pedido' }])
})

const ENTREGAR: EntregaVenda = {
  modo: 'entregar', modalidade: 'TransporteProprioPorContaDoRemetente',
  endereco: { cep: '65000000', logradouro: 'Rua de exemplo', numero: '100', complemento: '', bairro: 'Centro', cidade: '2111300', nomeCidade: 'São Luís', uf: 'MA' },
  recebe: null,
}

test('"Entregar" do pedido: endereço, quem recebe (o comprador) e a modalidade, só para conferir', async () => {
  await abrir(ENTREGAR)
  const t = entregaNaTela()
  assert.match(t, /Entregar em São Luís\/MA \(do pedido\)/)
  assert.match(t, /Rua de exemplo, 100, Centro, São Luís\/MA, CEP 65000-000/)
  assert.match(t, /Quem recebe: o comprador/)
  assert.match(t, /Modalidade: Loja leva com veículo próprio/)
})

test('outra pessoa recebe: a efetivação mostra o nome dela', async () => {
  await abrir({ ...ENTREGAR, recebe: { nome: 'Maria Exemplo', cpfCnpj: '52998224725' } } as EntregaVenda)
  assert.match(entregaNaTela(), /Quem recebe: Maria Exemplo/)
})

test('"Retira na loja" do pedido e pedido antigo sem Entrega', async () => {
  await abrir({ modo: 'retira', modalidade: '' })
  assert.match(entregaNaTela(), /Retira na loja \(do pedido\)/)
  assert.match(entregaNaTela(), /Modalidade: não escolhida/)
  for (const d of montados.splice(0)) await d()
  await abrir(null)
  assert.match(entregaNaTela(), /Pedido sem a Entrega informada/)
})

// "Alterar" (#895): o mesmo bloco do Novo pedido num diálogo; a Entrega muda no pedido e o total segue o frete novo.
const dialogoAlterar = () => document.querySelector('[aria-label="Alterar entrega"]')

test('"Alterar" abre a Entrega do pedido preenchida; trocar para "Retira na loja" envia ao pedido e a efetivação mostra a nova', async () => {
  await abrir(ENTREGAR)
  await clicar(alterarEntrega())
  assert.ok(dialogoAlterar(), 'o diálogo "Alterar entrega" abriu')
  const rua = document.getElementById('entrega-logradouro') as HTMLInputElement
  assert.equal(rua.value, 'Rua de exemplo')
  await clicar(document.querySelector('input[name="pedido-entrega"][value="retira"]'))
  await clicar(botao('Salvar entrega'))
  assert.deepEqual(alteracoes, [['p1', { modo: 'retira', modalidade: 'TransporteProprioPorContaDoRemetente' }]])
  assert.equal(dialogoAlterar(), null)
  assert.match(entregaNaTela(), /Retira na loja \(do pedido\)/)
})

test('"Alterar" na efetivação pode ligar o frete: vai ao pedido e o total passa a somar o frete novo', async () => {
  await abrir(ENTREGAR)
  await clicar(alterarEntrega())
  await clicar(botao('+ Frete'))
  await digitar(document.querySelector<HTMLInputElement>('[aria-label="Alterar entrega"] #alterar-frete')!, '35000')
  await clicar(botao('Salvar entrega'))
  assert.deepEqual(alteracoes, [['p1', { ...ENTREGAR, frete: 350 }]])
  assert.match(totalNaTela(), /R\$\s*9\.840,00/)
})

test('recusa do servidor no "Alterar" fica no diálogo e a Entrega do pedido não muda', async () => {
  respostaDoAlterar = { ok: false, erro: 'Pedido aguardando aprovação: recuse ou aprove antes de mudar a entrega.' }
  await abrir(ENTREGAR)
  await clicar(alterarEntrega())
  await clicar(document.querySelector('input[name="pedido-entrega"][value="retira"]'))
  await clicar(botao('Salvar entrega'))
  assert.match(dialogoAlterar()?.textContent ?? '', /Pedido aguardando aprovação/)
  assert.match(entregaNaTela(), /Entregar em São Luís\/MA \(do pedido\)/)
})

test('"Alterar" num pedido que já tem frete abre com o frete ligado e salvar sem mudar envia o mesmo frete', async () => {
  await abrir({ ...ENTREGAR, frete: 350 } as EntregaVenda)
  await clicar(alterarEntrega())
  assert.equal(document.querySelector<HTMLInputElement>('#alterar-frete')?.value.replace(/\D/g, ''), '35000')
  await clicar(botao('Salvar entrega'))
  assert.deepEqual(alteracoes, [['p1', { ...ENTREGAR, frete: 350 }]])
})

test('enquanto salva a Entrega: botões travados e Escape não fecha; ao responder, fecha', async () => {
  let responder!: () => void
  respostaDoAlterarFn = () => new Promise(r => { responder = () => r({ ok: true, dados: undefined }) })
  await abrir(ENTREGAR)
  await clicar(alterarEntrega())
  await clicar(botao('Salvar entrega'))
  assert.equal(botao('Salvando...')?.disabled, true)
  assert.equal(botao('Voltar')?.disabled, true)
  const { act } = await import('react')
  await act(async () => { document.activeElement?.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
  assert.ok(dialogoAlterar(), 'Escape não fecha enquanto salva')
  await act(async () => { responder() })
  assert.equal(dialogoAlterar(), null)
})

test('falha inesperada ao salvar a Entrega avisa no diálogo e libera para tentar de novo', async () => {
  respostaDoAlterarFn = async () => { throw new Error('rede') }
  await abrir(ENTREGAR)
  await clicar(alterarEntrega())
  await clicar(botao('Salvar entrega'))
  assert.match(dialogoAlterar()?.textContent ?? '', /Não deu para salvar a entrega agora\. Tente de novo\./)
  assert.equal(botao('Salvar entrega')?.disabled, false)
})

test('quem recebe com nome acima de 60 caracteres deixa o "Salvar entrega" desabilitado', async () => {
  await abrir({ ...ENTREGAR, recebe: { nome: 'Maria', cpfCnpj: '529.982.247-25' } } as EntregaVenda)
  await clicar(alterarEntrega())
  await digitar(document.getElementById('entrega-recebe-nome') as HTMLInputElement, 'x'.repeat(61))
  assert.equal(botao('Salvar entrega')?.disabled, true)
  assert.deepEqual(alteracoes, [])
})

test('a página recarregada com outra Entrega do pedido: a efetivação aberta mostra a nova', async () => {
  const recarregar = await abrir(ENTREGAR)
  await recarregar({ modo: 'retira', modalidade: '' })
  assert.match(entregaNaTela(), /Retira na loja \(do pedido\)/)
})
