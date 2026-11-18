// Novo pedido de venda com a Entrega (#725, layout B da #682): o que a tela mostra e o que envia ao
// servidor. A action é a fronteira de fora; o resto roda de verdade.
import { createElement } from 'react'
import test, { after, afterEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import { montarDom } from '@/test/montar-dom'
import { clicar, digitar, escolher } from '@/test/eventos-dom'

const { dom, desmontar: desmontarDom } = montarDom()
after(desmontarDom)
// O JSDOM não tem matchMedia: desktop (lg) por padrão; os testes do celular (#24, N3) desligam.
let desktop = true
;(dom.window as unknown as { matchMedia: unknown }).matchMedia = () =>
  ({ matches: desktop, addEventListener: () => {}, removeEventListener: () => {} })

type Resposta = { ok: true; dados: undefined } | { ok: false; erro: string }
const criar = mock.fn(async (_motos: unknown, _observacao: string, _entrega: unknown, _pecas?: unknown): Promise<Resposta> => ({ ok: true, dados: undefined }))
let minimo: { valorMinimoPix: number } | null = null
const CATALOGO = [
  { id: 'cap', nome: 'Capacete fechado', valor: '289.90', quantidadeEstoque: 1 },
  { id: 'bau', nome: 'Baú traseiro', valor: '249.00', quantidadeEstoque: 2 },
  { id: 'capa', nome: 'Capa de chuva', valor: '79.90', quantidadeEstoque: 0 },
]
let catalogo: { ok: true; dados: typeof CATALOGO } | { ok: false; erro: string } = { ok: true, dados: CATALOGO }
mock.module('../actions', { namedExports: {
  criarPedidoVendaAction: (motos: unknown, observacao: string, entrega: unknown, pecas?: unknown) =>
    (pecas === undefined ? criar(motos, observacao, entrega) : criar(motos, observacao, entrega, pecas)),
  buscarPrecoMinimoAction: async () => minimo,
  pecasDaLojaParaPedidoAction: async (lojaId: string) => (lojaId === 'norte' ? { ok: true, dados: CATALOGO.map(p => ({ ...p, quantidadeEstoque: 5 })) } : catalogo),
} })

const montados: (() => Promise<void>)[] = []
afterEach(async () => {
  criar.mock.resetCalls()
  minimo = null
  catalogo = { ok: true, dados: CATALOGO }
  desktop = true
  mock.restoreAll()
  for (const desmontar of montados.splice(0)) await desmontar()
})

const esperar = (ms: number) => new Promise(r => setTimeout(r, ms))
const textoDaTela = () => document.body.textContent ?? ''
const botao = (texto: string) => [...document.querySelectorAll('button')].find(b => (b.textContent ?? '').trim() === texto)
// Campo pelo rótulo visível; a asserção diz qual faltou, em vez de um TypeError adiante.
const campo = <T extends HTMLElement>(rotulo: RegExp) => {
  const label = [...document.querySelectorAll('label')].find(l => rotulo.test((l.textContent ?? '').trim()))
  const el = label?.htmlFor ? document.getElementById(label.htmlFor) : null
  assert.ok(el, `campo com o rótulo ${rotulo} não está na tela`)
  return el as T
}
const opcaoDeEntrega = (nome: RegExp) => [...document.querySelectorAll<HTMLInputElement>('[role="radiogroup"] input[type="radio"]')]
  .find(r => nome.test(r.closest('label')?.textContent ?? ''))
const resumo = () => document.querySelector('[aria-label="Resumo do pedido"]')?.textContent ?? ''

const MOTO = { id: 'moto-1', chassi: 'LA2026X4131', marca: 'MC', modelo: 'JET', cor: 'CINZA', lojaId: 'centro', lojaNome: 'Loja Centro' }
const PITICA = { ...MOTO, id: 'moto-2', chassi: 'LA2026X0088', modelo: 'PITICA', cor: 'BRANCA' }
const DO_NORTE = { ...MOTO, id: 'moto-3', chassi: 'LA2026X2217', modelo: 'JET MAX', lojaId: 'norte', lojaNome: 'Loja Norte' }
const SO_A_MOTO = [{ motoId: MOTO.id }]
const AVISO = 'Escolha a modalidade do frete. Sem ela a nota não sai.'

async function montar(motos = [MOTO], papel = 'vendedor') {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { CriarPedidoDialog } = await import('./criar-pedido-dialog')
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => { root.render(createElement(CriarPedidoDialog, { motos, papel })) })
  const clique = async (el: Element | null | undefined, ms = 50) => { await clicar(el); await act(() => esperar(ms)) }
  let montado = true
  montados.push(() => act(async () => { if (!montado) return; montado = false; root.unmount(); container.remove() }))
  await clique(botao('Criar Pedido de Venda'))
  // A busca do CEP responde depois da tecla: espera o "Buscando o CEP..." sumir, não um tempo fixo.
  const esperarBuscaDoCep = async () => {
    for (let i = 0; i < 40 && /Buscando o CEP/.test(textoDaTela()); i++) await act(() => esperar(5))
    assert.doesNotMatch(textoDaTela(), /Buscando o CEP/, 'a busca do CEP não terminou')
  }
  // "+ Moto" (ícone + texto "Moto") abre o painel lateral; marca as motos pelo nome e adiciona (V3 do protótipo).
  const adicionarMotos = async (...motos: typeof MOTO[]) => {
    await clique(botao('Moto'))
    for (const m of motos) await clique(caixaDaMoto(m))
    await clique([...document.querySelectorAll('button')].find(b => /^Adicionar \d+ motos?$/.test((b.textContent ?? '').trim())))
  }
  // "+ Acessório" / "+ Brinde": marca as peças pelo nome e, se pedido, soma na quantidade com o "+" da linha.
  const adicionarPecas = async (botaoDoTipo: string, ...pecas: [string, number?][]) => {
    await clique(botao(botaoDoTipo))
    for (const [nome, extra = 0] of pecas) {
      await clique(caixaDaPeca(nome))
      for (let i = 0; i < extra; i++) await clique(document.querySelector(`[aria-label="Mais um ${nome}"]`))
    }
    await clique([...document.querySelectorAll('button')].find(b => /^Adicionar \d+ peças?$/.test((b.textContent ?? '').trim())))
  }
  return { clique, esperarBuscaDoCep, adicionarMotos, adicionarPecas }
}
const caixaDaPeca = (nome: string) => [...document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')]
  .find(c => c.closest('label')?.querySelector('span')?.textContent === nome)
const itens = () => document.querySelector('[aria-label="Itens do pedido"]')?.textContent ?? ''
const caixaDaMoto = (m: typeof MOTO) => [...document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')]
  .find(c => (c.closest('label')?.textContent ?? '').includes(m.chassi.slice(-4)))
const nomesNoPainel = () => [...document.querySelectorAll('input[type="checkbox"]')].map(c => c.closest('label')?.querySelector('span')?.textContent)

test('abre com "Retira na loja" marcada, "Entregar" desmarcada e sem nenhuma modalidade escolhida, avisando', async () => {
  await montar()
  assert.equal(opcaoDeEntrega(/Retira na loja/)?.checked, true)
  assert.equal(opcaoDeEntrega(/Entregar/)?.checked, false)
  assert.equal(campo<HTMLSelectElement>(/^Modalidade do frete na nota/).value, '')
  assert.match(textoDaTela(), new RegExp(AVISO))
  assert.match(resumo(), /Retira na loja/)
  assert.match(resumo(), /Não escolhida/)
})

test('envia a moto e a Entrega com a modalidade escolhida; o aviso some e o resumo mostra a modalidade', async () => {
  const t = await montar()
  await t.adicionarMotos(MOTO)
  await escolher(campo<HTMLSelectElement>(/^Modalidade do frete na nota/), 'TransporteProprioPorContaDoDestinatario')
  assert.doesNotMatch(textoDaTela(), new RegExp(AVISO))
  assert.match(resumo(), /Cliente leva com veículo próprio/)
  await t.clique(botao('Criar pedido'))
  assert.deepEqual(criar.mock.calls.map(c => c.arguments), [
    [SO_A_MOTO, '', { modo: 'retira', modalidade: 'TransporteProprioPorContaDoDestinatario' }],
  ])
})

test('sem modalidade o pedido sai assim mesmo (avisa, não bloqueia) com a modalidade vazia', async () => {
  const t = await montar()
  await t.adicionarMotos(MOTO)
  await t.clique(botao('Criar pedido'))
  assert.deepEqual(criar.mock.calls.map(c => c.arguments), [[SO_A_MOTO, '', { modo: 'retira', modalidade: '' }]])
})

test('o cabeçalho mostra a loja da moto escolhida', async () => {
  const t = await montar()
  const subtitulo = () => document.querySelector('[data-slot="dialog-description"]')?.textContent ?? ''
  assert.equal(subtitulo(), 'Escolha a moto para ver a loja do pedido.')
  await t.adicionarMotos(MOTO)
  assert.equal(subtitulo(), 'Loja Centro')
})

// "Entregar" (#726): o CEP preenche o endereço pela busca de CEP (ViaCEP, a fronteira de fora).
const VIACEP_SAO_LUIS = { logradouro: 'Rua de exemplo', bairro: 'Centro', localidade: 'São Luís', uf: 'MA', ibge: '2111300' }
function viaCep(resposta: object) {
  mock.method(globalThis, 'fetch', async (url: string) => {
    assert.match(String(url), /^https:\/\/viacep\.com\.br\/ws\/65000000\/json\/$/)
    return Response.json(resposta)
  })
}

async function entregarComCep(t: Awaited<ReturnType<typeof montar>>) {
  await t.adicionarMotos(MOTO)
  await t.clique(opcaoDeEntrega(/Entregar/))
  await digitar(campo<HTMLInputElement>(/^CEP/), '65000000')
  await t.esperarBuscaDoCep()
  await digitar(campo<HTMLInputElement>(/^Número/), '100')
  await escolher(campo<HTMLSelectElement>(/^Modalidade do frete na nota/), 'TransporteProprioPorContaDoRemetente')
}

const ENDERECO_SAO_LUIS = {
  cep: '65000-000', logradouro: 'Rua de exemplo', numero: '100', complemento: '', bairro: 'Centro',
  cidade: '2111300', nomeCidade: 'São Luís', uf: 'MA',
}

test('"Entregar": o CEP preenche rua, bairro, cidade, UF e o código IBGE; envia o endereço com o comprador recebendo', async () => {
  viaCep(VIACEP_SAO_LUIS)
  const t = await montar()
  await entregarComCep(t)
  await t.clique(botao('Editar endereço'))
  assert.equal(campo<HTMLInputElement>(/^Rua/).value, 'Rua de exemplo')
  assert.equal(campo<HTMLSelectElement>(/^UF/).value, 'MA')
  assert.equal([...document.querySelectorAll('label')].some(l => /Código IBGE/.test(l.textContent ?? '')), false)
  assert.match(resumo(), /Entregar em São Luís\/MA/)
  await t.clique(botao('Criar pedido'))
  assert.deepEqual(criar.mock.calls.map(c => c.arguments), [[SO_A_MOTO, '', {
    modo: 'entregar', modalidade: 'TransporteProprioPorContaDoRemetente', endereco: ENDERECO_SAO_LUIS, recebe: null,
  }]])
})

test('CEP não encontrado: aparece o código IBGE do município para digitar', async () => {
  viaCep({ erro: true })
  const t = await montar()
  await entregarComCep(t)
  await digitar(campo<HTMLInputElement>(/^Rua/), 'Rua de exemplo')
  await digitar(campo<HTMLInputElement>(/^Bairro/), 'Centro')
  await digitar(campo<HTMLInputElement>(/^Cidade/), 'São Luís')
  await escolher(campo<HTMLSelectElement>(/^UF/), 'MA')
  await digitar(campo<HTMLInputElement>(/^Código IBGE do município/), '2111300')
  await t.clique(botao('Criar pedido'))
  assert.deepEqual(criar.mock.calls[0].arguments[2], {
    modo: 'entregar', modalidade: 'TransporteProprioPorContaDoRemetente', endereco: ENDERECO_SAO_LUIS, recebe: null,
  })
})

// CEP primeiro (#846, variante B): o endereço completo só aparece quando o CEP não resolve ou ao editar.
const temRotulo = (rotulo: RegExp) => [...document.querySelectorAll('label')].some(l => rotulo.test((l.textContent ?? '').trim()))

test('"Entregar" começa só com o CEP, sem os outros campos do endereço', async () => {
  const t = await montar()
  await t.clique(opcaoDeEntrega(/Entregar/))
  assert.equal(temRotulo(/^CEP/), true)
  for (const r of [/^Rua/, /^Número/, /^Complemento/, /^Bairro/, /^Cidade/, /^UF/]) assert.equal(temRotulo(r), false, `${r} apareceu antes do CEP`)
})

test('CEP achado: mostra "Endereço encontrado", o resumo e só Número e Complemento para digitar', async () => {
  viaCep(VIACEP_SAO_LUIS)
  const t = await montar()
  await entregarComCep(t)
  assert.match(textoDaTela(), /Endereço encontrado/)
  assert.match(textoDaTela(), /Rua de exemplo/)
  assert.match(textoDaTela(), /Centro, São Luís \/ MA/)
  assert.equal(temRotulo(/^Complemento/), true)
  for (const r of [/^Rua/, /^Bairro/, /^Cidade/, /^UF/]) assert.equal(temRotulo(r), false, `${r} apareceu com o CEP achado`)
})

test('CEP não achado: abre o endereço completo, com o código IBGE', async () => {
  viaCep({ erro: true })
  const t = await montar()
  await entregarComCep(t)
  for (const r of [/^Rua/, /^Número/, /^Complemento/, /^Bairro/, /^Cidade/, /^UF/, /^Código IBGE/]) assert.equal(temRotulo(r), true, `${r} faltou`)
  assert.doesNotMatch(textoDaTela(), /Endereço encontrado/)
})

test('"Editar endereço" abre o endereço completo com o que o CEP e a pessoa já preencheram', async () => {
  viaCep(VIACEP_SAO_LUIS)
  const t = await montar()
  await entregarComCep(t)
  assert.ok(botao('Editar endereço'), 'sem o link "Editar endereço"')
  await t.clique(botao('Editar endereço'))
  assert.equal(campo<HTMLInputElement>(/^Rua/).value, 'Rua de exemplo')
  assert.equal(campo<HTMLInputElement>(/^Número/).value, '100')
  assert.equal(campo<HTMLInputElement>(/^Bairro/).value, 'Centro')
  assert.equal(campo<HTMLInputElement>(/^Cidade/).value, 'São Luís')
  assert.equal(campo<HTMLSelectElement>(/^UF/).value, 'MA')
  assert.equal(botao('Editar endereço'), undefined)
})

test('CEP achado: envia do resumo, sem abrir "Editar endereço", o endereço completo', async () => {
  viaCep(VIACEP_SAO_LUIS)
  const t = await montar()
  await entregarComCep(t)
  await t.clique(botao('Criar pedido'))
  assert.deepEqual((criar.mock.calls[0].arguments[2] as { endereco: object }).endereco, ENDERECO_SAO_LUIS)
})

test('CEP achado sem código IBGE: abre o endereço completo para digitar o código', async () => {
  viaCep({ ...VIACEP_SAO_LUIS, ibge: '' })
  const t = await montar()
  await entregarComCep(t)
  assert.equal(campo<HTMLInputElement>(/^Rua/).value, 'Rua de exemplo')
  assert.equal(temRotulo(/^Código IBGE/), true)
})

// CEP geral (cidade inteira) volta sem rua: o resumo ficaria sem rua e sem campo para digitá-la.
test('CEP achado sem rua: abre o endereço completo, com a cidade que veio', async () => {
  viaCep({ ...VIACEP_SAO_LUIS, logradouro: '', bairro: '' })
  const t = await montar()
  await entregarComCep(t)
  assert.equal(campo<HTMLInputElement>(/^Rua/).value, '')
  assert.equal(campo<HTMLInputElement>(/^Cidade/).value, 'São Luís')
  assert.doesNotMatch(textoDaTela(), /Endereço encontrado/)
})

test('trocar o CEP depois do resumo: some o endereço do CEP antigo, na tela e no envio', async () => {
  viaCep(VIACEP_SAO_LUIS)
  const t = await montar()
  await entregarComCep(t)
  await digitar(campo<HTMLInputElement>(/^CEP/), '6500000')
  assert.doesNotMatch(textoDaTela(), /Endereço encontrado|Rua de exemplo/)
  await t.clique(botao('Criar pedido'))
  const enviado = (criar.mock.calls[0].arguments[2] as { endereco: Record<string, string> }).endereco
  assert.deepEqual([enviado.logradouro, enviado.bairro, enviado.nomeCidade, enviado.uf, enviado.cidade], ['', '', '', '', ''])
  assert.equal(enviado.numero, '100')
})

test('"Outra pessoa recebe" com CPF inválido mostra o erro e não deixa criar; com CPF válido envia nome e documento', async () => {
  viaCep(VIACEP_SAO_LUIS)
  const t = await montar()
  await entregarComCep(t)
  await t.clique(campo<HTMLInputElement>(/^Outra pessoa recebe/))
  await digitar(campo<HTMLInputElement>(/^Nome de quem recebe/), 'Maria Exemplo')
  await digitar(campo<HTMLInputElement>(/^CPF ou CNPJ de quem recebe/), '52998224724')
  assert.match(textoDaTela(), /CPF inválido\. Confira os números\./)
  assert.equal(botao('Criar pedido')?.disabled, true)
  await digitar(campo<HTMLInputElement>(/^CPF ou CNPJ de quem recebe/), '52998224725')
  await t.clique(botao('Criar pedido'))
  assert.deepEqual(criar.mock.calls[0].arguments[2], {
    modo: 'entregar', modalidade: 'TransporteProprioPorContaDoRemetente', endereco: ENDERECO_SAO_LUIS,
    recebe: { nome: 'Maria Exemplo', cpfCnpj: '529.982.247-25' },
  })
})

test('voltar para "Retira na loja" envia só a retirada, sem o endereço digitado', async () => {
  viaCep(VIACEP_SAO_LUIS)
  const t = await montar()
  await entregarComCep(t)
  await t.clique(opcaoDeEntrega(/Retira na loja/))
  await t.clique(botao('Criar pedido'))
  assert.deepEqual(criar.mock.calls[0].arguments[2], { modo: 'retira', modalidade: 'TransporteProprioPorContaDoRemetente' })
})

const temCampoIbge = () => [...document.querySelectorAll('label')].some(l => /^Código IBGE do município/.test(l.textContent ?? ''))

test('trocar a UF depois do CEP apaga o código IBGE e pede o novo, que fica visível até o fim', async () => {
  viaCep(VIACEP_SAO_LUIS)
  const t = await montar()
  await entregarComCep(t)
  await t.clique(botao('Editar endereço'))
  await escolher(campo<HTMLSelectElement>(/^UF/), 'PI')
  assert.equal(campo<HTMLInputElement>(/^Código IBGE do município/).value, '')
  await digitar(campo<HTMLInputElement>(/^Código IBGE do município/), '2211001')
  assert.equal(temCampoIbge(), true)
  await t.clique(botao('Criar pedido'))
  assert.deepEqual((criar.mock.calls[0].arguments[2] as { endereco: object }).endereco, { ...ENDERECO_SAO_LUIS, uf: 'PI', cidade: '2211001' })
})

test('trocar a cidade à mão depois do CEP apaga o código IBGE e pede o novo', async () => {
  viaCep(VIACEP_SAO_LUIS)
  const t = await montar()
  await entregarComCep(t)
  await t.clique(botao('Editar endereço'))
  await digitar(campo<HTMLInputElement>(/^Cidade/), 'Paço do Lumiar')
  assert.equal(campo<HTMLInputElement>(/^Código IBGE do município/).value, '')
})

test('nome de quem recebe com mais de 60 caracteres: a tela mostra a mesma recusa do servidor e não deixa criar', async () => {
  viaCep(VIACEP_SAO_LUIS)
  const t = await montar()
  await entregarComCep(t)
  await t.clique(campo<HTMLInputElement>(/^Outra pessoa recebe/))
  await digitar(campo<HTMLInputElement>(/^Nome de quem recebe/), 'x'.repeat(61))
  await digitar(campo<HTMLInputElement>(/^CPF ou CNPJ de quem recebe/), '52998224725')
  assert.match(textoDaTela(), /O nome de quem recebe aceita no máximo 60 caracteres\./)
  assert.equal(botao('Criar pedido')?.disabled, true)
})

// Frete cobrado (#726, 4b): "+ Frete" só com a loja fazendo o frete (decisão do Luis, 07/11/2026).
const botaoFrete = () => [...document.querySelectorAll('button')].find(b => /^\+ Frete|Frete adicionado/.test((b.textContent ?? '').trim()))

test('"+ Frete" com "Loja leva": o valor cobrado entra no resumo e vai na Entrega', async () => {
  viaCep(VIACEP_SAO_LUIS)
  const t = await montar()
  await entregarComCep(t)
  await t.clique(botaoFrete())
  await digitar(campo<HTMLInputElement>(/^Valor cobrado do cliente/), '35000')
  assert.match(resumo(), /Frete\s*R\$\s*350,00/)
  await t.clique(botao('Criar pedido'))
  assert.deepEqual(criar.mock.calls[0].arguments[2], {
    modo: 'entregar', modalidade: 'TransporteProprioPorContaDoRemetente', endereco: ENDERECO_SAO_LUIS, recebe: null, frete: 350,
  })
})

test('"+ Frete" fica indisponível quando a loja não faz o frete, e trocar a modalidade tira o frete já digitado', async () => {
  viaCep(VIACEP_SAO_LUIS)
  const t = await montar()
  await entregarComCep(t)
  await t.clique(botaoFrete())
  await digitar(campo<HTMLInputElement>(/^Valor cobrado do cliente/), '35000')
  await escolher(campo<HTMLSelectElement>(/^Modalidade do frete na nota/), 'ContratacaoPorContaDoDestinatario')
  assert.equal(botaoFrete()?.disabled, true)
  assert.doesNotMatch(resumo(), /Frete/)
  await t.clique(botao('Criar pedido'))
  assert.equal('frete' in (criar.mock.calls[0].arguments[2] as object), false)
})

test('"+ Frete" na retirada marca "Entregar"', async () => {
  const t = await montar()
  await t.adicionarMotos(MOTO)
  await escolher(campo<HTMLSelectElement>(/^Modalidade do frete na nota/), 'TransporteProprioPorContaDoRemetente')
  await t.clique(botaoFrete())
  assert.equal(opcaoDeEntrega(/Entregar/)?.checked, true)
})

test('"Frete adicionado" sem valor avisa que o pedido sai sem frete (avisa, não bloqueia)', async () => {
  viaCep(VIACEP_SAO_LUIS)
  const t = await montar()
  await entregarComCep(t)
  await t.clique(botaoFrete())
  assert.match(textoDaTela(), /Informe o valor do frete\. Sem ele não há frete cobrado\./)
  await digitar(campo<HTMLInputElement>(/^Valor cobrado do cliente/), '35000')
  assert.doesNotMatch(textoDaTela(), /Informe o valor do frete/)
})

// Endereço que já chega preenchido (além do CEP) abre inteiro: nada fica escondido.
test('EntregaCampos com endereço já preenchido abre os campos completos', async () => {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { EntregaCampos, ENTREGA_DO_FORMULARIO_INICIAL } = await import('./entrega-campos')
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  montados.push(() => act(async () => { root.unmount(); container.remove() }))
  const valor = { ...ENTREGA_DO_FORMULARIO_INICIAL, modo: 'entregar' as const, endereco: { ...ENDERECO_SAO_LUIS } }
  await act(async () => { root.render(createElement(EntregaCampos, { valor, onChange: () => {} })) })
  assert.equal(campo<HTMLInputElement>(/^Rua/).value, 'Rua de exemplo')
  assert.equal(botao('Editar endereço'), undefined)
})

// Recusa do servidor (#848): aparece dentro do diálogo, que continua aberto com tudo o que foi digitado.
test('recusa do servidor aparece dentro do diálogo, sem fechar nem apagar o que foi digitado; some ao tentar de novo', async () => {
  const frase = 'Entrega para outro estado ainda não disponível. Use Retira na loja ou entrega no mesmo estado.'
  viaCep(VIACEP_SAO_LUIS)
  const t = await montar()
  await entregarComCep(t)
  criar.mock.mockImplementationOnce(async () => ({ ok: false, erro: frase }))
  await t.clique(botao('Criar pedido'))
  const dialogo = () => document.querySelector('[role="dialog"]')
  assert.ok(dialogo(), 'o diálogo fechou')
  assert.match(dialogo()?.textContent ?? '', new RegExp(frase.replace(/\./g, '\\.')))
  assert.match(document.querySelector('[aria-label="Motos do pedido"]')?.textContent ?? '', /MC JET/)
  assert.equal(campo<HTMLInputElement>(/^Número/).value, '100')
  assert.match(resumo(), /Entregar em São Luís\/MA/)

  await t.clique(botao('Criar pedido'))
  assert.doesNotMatch(textoDaTela(), new RegExp(frase.replace(/\./g, '\\.')))
})

test('marca 2 motos no painel; entram na ordem marcada, a 1ª com valor e a 2ª sem (D-E2); o resumo soma só o preenchido', async () => {
  minimo = { valorMinimoPix: 9000 }
  const t = await montar([MOTO, PITICA])
  await t.adicionarMotos(MOTO, PITICA)
  const lista = () => document.querySelector('[aria-label="Motos do pedido"]')?.textContent ?? ''
  assert.match(lista(), /MC JET.*Chassi final 4131.*MC PITICA.*Chassi final 0088/)
  assert.match(lista(), /Mínimo à vista\s*R\$\s*9\.000,00/)
  await digitar(campo<HTMLInputElement>(/^Valor da MC JET/), '949000')
  assert.match(resumo(), /Motos \(2\)\s*R\$\s*9\.490,00/)
  await t.clique(botao('Criar pedido'))
  assert.deepEqual(criar.mock.calls[0].arguments[0], [{ motoId: MOTO.id, valor: 9490 }, { motoId: PITICA.id }])
})

test('o painel só oferece a loja da 1ª moto e tira as que já estão no pedido; sem moto, de todas as lojas', async () => {
  const t = await montar([MOTO, PITICA, DO_NORTE])
  await t.clique(botao('Moto'))
  assert.deepEqual(nomesNoPainel(), ['MC JET', 'MC PITICA', 'MC JET MAX'])
  await t.clique(caixaDaMoto(MOTO))
  assert.deepEqual(nomesNoPainel(), ['MC JET', 'MC PITICA'])
  await t.clique(botao('Adicionar 1 moto'))
  await t.clique(botao('Moto'))
  assert.deepEqual(nomesNoPainel(), ['MC PITICA'])
})

test('a lixeira tira a moto do pedido; sem moto, "Criar pedido" fica desabilitado', async () => {
  const t = await montar([MOTO, PITICA])
  await t.adicionarMotos(MOTO, PITICA)
  assert.match(document.querySelector('[aria-label="Motos do pedido"]')?.textContent ?? '', /MC JET.*MC PITICA/)
  await t.clique(document.querySelector('[aria-label="Tirar a MC JET do pedido"]'))
  assert.doesNotMatch(document.querySelector('[aria-label="Motos do pedido"]')?.textContent ?? '', /MC JET/)
  await t.clique(document.querySelector('[aria-label="Tirar a MC PITICA do pedido"]'))
  assert.equal(botao('Criar pedido')?.disabled, true)
})

test('valor zerado mostra "Valor inválido" e não deixa criar', async () => {
  const t = await montar()
  await t.adicionarMotos(MOTO)
  await digitar(campo<HTMLInputElement>(/^Valor da MC JET/), '0')
  assert.match(textoDaTela(), /Valor inválido/)
  assert.equal(botao('Criar pedido')?.disabled, true)
})

test('"+ Brinde" e "+ Acessório" ficam desabilitados até a 1ª moto, com a dica', async () => {
  const t = await montar()
  assert.equal(botao('Brinde')?.disabled, true)
  assert.equal(botao('Acessório')?.disabled, true)
  assert.match(textoDaTela(), /Escolha a moto primeiro/)
  await t.adicionarMotos(MOTO)
  assert.equal(botao('Acessório')?.disabled, false)
  assert.doesNotMatch(textoDaTela(), /Escolha a moto primeiro/)
})

test('vendedor: acessórios pelo painel com quantidade e o preço do catálogo sem campo; brinde "Sem cobrança"; aviso de saldo; envio e resumo', async () => {
  const t = await montar()
  await t.adicionarMotos(MOTO)
  await t.clique(botao('Acessório'))
  assert.match(textoDaTela(), /Capacete fechado.*Saldo 1.*Baú traseiro.*Saldo 2.*Capa de chuva.*Saldo 0/)
  await t.clique(botao('Só com saldo na loja'))
  assert.equal(caixaDaPeca('Capa de chuva'), undefined)
  await t.clique(document.querySelector('[data-slot="sheet-close"]'))
  await t.adicionarPecas('Acessório', ['Capacete fechado', 1])
  await t.adicionarPecas('Brinde', ['Baú traseiro'])
  assert.match(itens(), /Capacete fechado.*Fica em -1 depois deste pedido; não trava a venda/)
  assert.match(itens(), /Baú traseiro.*Sem cobrança \(catálogo R\$\s*249,00\)/)
  assert.equal([...document.querySelectorAll('label')].some(l => /Valor de cada/.test(l.textContent ?? '')), false)
  assert.match(resumo(), /1 moto sem valor.*Acessórios \(2\)\s*R\$\s*579,80.*Brindes \(1\)\s*Sem cobrança/)
  assert.match(resumo(), /Total\s*R\$\s*579,80/)
  await t.clique(botao('Criar pedido'))
  assert.deepEqual(criar.mock.calls[0].arguments[3], [
    { tipo: 'acessorio', pecaId: 'cap', quantidade: 2 }, { tipo: 'brinde', pecaId: 'bau', quantidade: 1 },
  ])
})

test('quem gere peças ajusta o valor do acessório, que vai no envio', async () => {
  const t = await montar([MOTO], 'aux_adm')
  await t.adicionarMotos(MOTO)
  await t.adicionarPecas('Acessório', ['Capacete fechado'])
  await digitar(campo<HTMLInputElement>(/^Valor de cada Capacete fechado/), '25000')
  await t.clique(botao('Criar pedido'))
  assert.deepEqual(criar.mock.calls[0].arguments[3], [{ tipo: 'acessorio', pecaId: 'cap', quantidade: 1, valorUnitario: 250 }])
})

test('catálogo que não carrega avisa por quê, sem sumir com o botão', async () => {
  catalogo = { ok: false, erro: 'Loja não encontrada' }
  const t = await montar()
  await t.adicionarMotos(MOTO)
  await t.clique(botao('Acessório'))
  assert.match(textoDaTela(), /Não deu para carregar as peças: Loja não encontrada/)
})

test('trocar a loja do pedido (outra 1ª moto) atualiza o saldo das peças já escolhidas', async () => {
  const t = await montar([MOTO, DO_NORTE])
  await t.adicionarMotos(MOTO)
  await t.adicionarPecas('Acessório', ['Capacete fechado', 1])
  assert.match(itens(), /Fica em -1/)
  await t.clique(document.querySelector('[aria-label="Tirar a MC JET do pedido"]'))
  await t.adicionarMotos(DO_NORTE)
  assert.match(itens(), /Capacete fechado/)
  assert.doesNotMatch(itens(), /Fica em/)
})

// Celular (#24, N3): os blocos do próprio pedido abrem com a busca embutida; o pedido e o total ficam à vista.
const bloco = (nome: string) => [...document.querySelectorAll<HTMLButtonElement>('button[aria-expanded]')].find(b => (b.textContent ?? '').startsWith(nome))
const por = (nome: string) => document.querySelector(`[aria-label="Pôr ${nome} no pedido"]`)

test('celular: blocos com a busca embutida; um toque põe a moto e a peça no bloco (outro toque soma); o total segue no rodapé', async () => {
  desktop = false
  const t = await montar([MOTO, PITICA])
  assert.ok(!botao('Moto'), 'o "+ Moto" do painel lateral não aparece no celular')
  assert.equal(bloco('Motos')?.getAttribute('aria-expanded'), 'true')
  assert.equal(bloco('Acessórios')?.disabled, true)
  assert.match(textoDaTela(), /Escolha a moto primeiro/)
  await t.clique(por('MC JET (final 4131)'))
  assert.match(document.querySelector('[aria-label="Motos do pedido"]')?.textContent ?? '', /MC JET/)
  assert.ok(!por('MC JET (final 4131)'), 'a moto que entrou sai da busca')

  await t.clique(bloco('Acessórios'))
  await digitar(document.querySelector<HTMLInputElement>('input[aria-label="Buscar peça"]')!, 'capacete')
  await t.clique(por('Capacete fechado'))
  await t.clique(por('Capacete fechado'))
  assert.equal(document.querySelector('[aria-label="Quantidade de Capacete fechado"]')?.textContent, '2')
  assert.match(itens(), /Capacete fechado.*Fica em -1/)
  assert.match(bloco('Acessórios')?.textContent ?? '', /2 itens\s*R\$\s*579,80/)
  assert.match(document.querySelector('[data-slot="dialog-footer"]')?.textContent ?? '', /Total do pedido\s*R\$\s*579,80/)
  await t.clique(botao('Criar pedido'))
  assert.deepEqual(criar.mock.calls[0].arguments[0], [{ motoId: MOTO.id }])
  assert.deepEqual(criar.mock.calls[0].arguments[3], [{ tipo: 'acessorio', pecaId: 'cap', quantidade: 2 }])
})

test('celular: brinde entra "Sem cobrança" no próprio bloco e não muda o total', async () => {
  desktop = false
  const t = await montar()
  await t.clique(por('MC JET (final 4131)'))
  assert.ok(bloco('Brindes'), 'o bloco Brindes não está na tela')
  await t.clique(bloco('Brindes'))
  await digitar(document.querySelector<HTMLInputElement>('input[aria-label="Buscar peça"]')!, 'bau')
  await t.clique(por('Baú traseiro'))
  assert.match(bloco('Brindes')?.textContent ?? '', /1 item\s*Sem cobrança/)
  assert.match(itens(), /Baú traseiro.*Sem cobrança \(catálogo R\$\s*249,00\)/)
  assert.match(document.querySelector('[data-slot="dialog-footer"]')?.textContent ?? '', /Total do pedido\s*R\$\s*0,00/)
})
