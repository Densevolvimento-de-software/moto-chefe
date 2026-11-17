// Tela de acessos da fábrica (#3, variante 3 do protótipo): lista com busca e situação, painel lateral
// para criar e para o acesso (desativar, trocar senha), o que cada caminho envia e o que a tela mostra
// quando a action recusa. As actions e o toast são a fronteira de fora; o resto roda de verdade.
import { createElement } from 'react'
import test, { after, afterEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import { montarDom } from '@/test/montar-dom'
import { clicar, digitar } from '@/test/eventos-dom'

const { desmontar: desmontarDom } = montarDom()
after(desmontarDom)

type Resposta = { ok: true; dados?: unknown } | { ok: false; erro: string }
const criar = mock.fn(async (_entrada: unknown): Promise<Resposta> => ({ ok: true, dados: { id: 'novo' } }))
const alternar = mock.fn(async (_id: string, _ativo: boolean): Promise<Resposta> => ({ ok: true }))
const redefinir = mock.fn(async (_id: string, _senha: string): Promise<Resposta> => ({ ok: true }))
mock.module('../actions', { namedExports: {
  criarAcessoFabricaAction: (e: unknown) => criar(e),
  alternarAcessoFabricaAction: (id: string, ativo: boolean) => alternar(id, ativo),
  redefinirSenhaFabricaAction: (id: string, senha: string) => redefinir(id, senha),
} })
const erros: string[] = []
mock.module('sonner', { namedExports: { toast: { error: (m: string) => { erros.push(m) }, success: () => {} } } })

const montados: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const f of [criar, alternar, redefinir]) f.mock.resetCalls()
  erros.length = 0
  for (const desmontar of montados.splice(0)) await desmontar()
})

const esperar = (ms: number) => new Promise(r => setTimeout(r, ms))
const texto = () => document.body.textContent ?? ''
const botao = (rotulo: string) => [...document.querySelectorAll('button')].find(b => (b.textContent ?? '').trim() === rotulo)
// A tabela (computador) e os cartões (celular) estão no DOM juntos: o primeiro botão do acesso basta.
const botaoDoAcesso = (nome: string) => [...document.querySelectorAll('button')].find(b => (b.textContent ?? '').includes(nome))
const campo = (rotulo: RegExp) => {
  const label = [...document.querySelectorAll('label')].find(l => rotulo.test((l.textContent ?? '').trim()))
  return document.getElementById(label!.htmlFor) as HTMLInputElement
}

const ACESSOS = [
  { id: 'f-1', nome: 'Fábrica Comercial', email: 'comercial@teste.invalid', ativo: true },
  { id: 'f-2', nome: 'Fábrica Compras', email: 'compras@teste.invalid', ativo: true },
  { id: 'f-3', nome: 'Fábrica Diretoria', email: 'diretoria@teste.invalid', ativo: false },
]

async function montar(acessos = ACESSOS) {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { AcessosFabrica } = await import('./acessos-fabrica')
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => { root.render(createElement(AcessosFabrica, { acessos })) })
  const clique = async (el: Element | undefined) => { await clicar(el); await act(() => esperar(50)) }
  let montado = true
  montados.push(() => act(async () => { if (!montado) return; montado = false; root.unmount(); container.remove() }))
  return { clique }
}

test('lista: abre nos ativos; o inativo aparece em Inativos; o rodapé conta todos', async () => {
  const { clique } = await montar()
  assert.ok(botaoDoAcesso('Fábrica Comercial') && botaoDoAcesso('Fábrica Compras'))
  assert.equal(botaoDoAcesso('Fábrica Diretoria'), undefined)
  assert.ok(texto().includes('3 acessos, 1 inativo'))
  await clique(botao('Inativos'))
  assert.ok(botaoDoAcesso('Fábrica Diretoria'))
  assert.equal(botaoDoAcesso('Fábrica Comercial'), undefined)
})

test('busca por nome ou e-mail, sem acento', async () => {
  await montar()
  const { act } = await import('react')
  await digitar(document.querySelector<HTMLInputElement>('input[aria-label="Buscar acesso"]')!, 'compras')
  await act(() => esperar(20))
  assert.ok(botaoDoAcesso('Fábrica Compras'))
  assert.equal(botaoDoAcesso('Fábrica Comercial'), undefined)
})

test('sem acessos: mostra o convite e o Novo acesso abre o painel de criar', async () => {
  const { clique } = await montar([])
  assert.ok(texto().includes('Nenhum acesso da fábrica ainda'))
  await clique(botao('Novo acesso'))
  assert.ok(campo(/^E-mail do login$/))
})

test('criar envia só nome, e-mail e senha, já limpos', async () => {
  const { clique } = await montar()
  await clique(botao('Novo acesso'))
  await digitar(campo(/^Nome$/), '  Fábrica Logística  ')
  await digitar(campo(/^E-mail do login$/), ' Logistica@Teste.Invalid ')
  await digitar(campo(/^Senha$/), '12345678')
  await clique(botao('Criar acesso'))
  assert.deepEqual(criar.mock.calls.map(c => c.arguments), [[{ nome: 'Fábrica Logística', email: 'logistica@teste.invalid', senha: '12345678' }]])
})

test('criar com senha curta não chama a action e mostra a frase', async () => {
  const { clique } = await montar()
  await clique(botao('Novo acesso'))
  await digitar(campo(/^Nome$/), 'F')
  await digitar(campo(/^E-mail do login$/), 'a@teste.invalid')
  await digitar(campo(/^Senha$/), '123')
  await clique(botao('Criar acesso'))
  assert.equal(criar.mock.callCount(), 0)
  assert.deepEqual(erros, ['A senha deve ter pelo menos 8 caracteres.'])
})

test('clicar no acesso abre o painel; desativar envia o id e o novo estado, e a recusa aparece', async () => {
  alternar.mock.mockImplementationOnce(async () => ({ ok: false, erro: 'Não foi possível mudar o acesso agora. Tente de novo.' }))
  const { clique } = await montar()
  await clique(botaoDoAcesso('Fábrica Comercial'))
  await clique(botao('Desativar'))
  assert.deepEqual(alternar.mock.calls.map(c => c.arguments), [['f-1', false]])
  assert.deepEqual(erros, ['Não foi possível mudar o acesso agora. Tente de novo.'])
})

test('acesso inativo mostra Reativar, que envia ativo = true', async () => {
  const { clique } = await montar()
  await clique(botao('Todos'))
  await clique(botaoDoAcesso('Fábrica Diretoria'))
  await clique(botao('Reativar'))
  assert.deepEqual(alternar.mock.calls.map(c => c.arguments), [['f-3', true]])
})

test('trocar senha no painel envia o id e a senha nova; senha curta não chama a action', async () => {
  const { clique } = await montar()
  await clique(botaoDoAcesso('Fábrica Compras'))
  await digitar(campo(/^Nova senha$/), '123')
  await clique(botao('Salvar senha'))
  assert.equal(redefinir.mock.callCount(), 0)
  await digitar(campo(/^Nova senha$/), 'nova-senha-1')
  await clique(botao('Salvar senha'))
  assert.deepEqual(redefinir.mock.calls.map(c => c.arguments), [['f-2', 'nova-senha-1']])
})

// Erro fora da lista (banco, rede) não pode deixar a tela sem resposta (#3, spec D).
test('falha inesperada em qualquer ação vira uma frase na tela', async () => {
  const falha = async () => { throw new Error('banco fora') }
  criar.mock.mockImplementationOnce(falha)
  alternar.mock.mockImplementationOnce(falha)
  redefinir.mock.mockImplementationOnce(falha)
  const { clique } = await montar()
  await clique(botao('Novo acesso'))
  await digitar(campo(/^Nome$/), 'F')
  await digitar(campo(/^E-mail do login$/), 'a@teste.invalid')
  await digitar(campo(/^Senha$/), '12345678')
  await clique(botao('Criar acesso'))
  await clique(botao('Cancelar'))
  await clique(botaoDoAcesso('Fábrica Comercial'))
  await clique(botao('Desativar'))
  await digitar(campo(/^Nova senha$/), 'nova-senha-1')
  await clique(botao('Salvar senha'))
  assert.deepEqual(erros, Array(3).fill('Não deu para concluir agora. Tente de novo.'))
})

test('nenhum texto da tela nem do painel tem travessão', async () => {
  const { clique } = await montar()
  assert.ok(!texto().includes('—'))
  await clique(botao('Novo acesso'))
  assert.ok(!texto().includes('—'))
  assert.ok(![...document.querySelectorAll('input')].some(i => (i.placeholder ?? '').includes('—')))
})
