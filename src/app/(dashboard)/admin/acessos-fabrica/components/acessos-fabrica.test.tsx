// Tela de acessos da fábrica (#3): o que cada caminho envia para a action e o que a tela mostra
// quando ela recusa. As actions e o toast são a fronteira de fora; o resto roda de verdade.
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
const botao = (texto: string) => [...document.querySelectorAll('button')].find(b => (b.textContent ?? '').trim() === texto)
const campo = (rotulo: RegExp) => {
  const label = [...document.querySelectorAll('label')].find(l => rotulo.test((l.textContent ?? '').trim()))
  return document.getElementById(label!.htmlFor) as HTMLInputElement
}

const ACESSOS = [{ id: 'f-1', nome: 'Fábrica Comercial', email: 'comercial@teste.invalid', ativo: true }]

async function montar() {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { AcessosFabrica } = await import('./acessos-fabrica')
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => { root.render(createElement(AcessosFabrica, { acessos: ACESSOS })) })
  const clique = async (el: Element | undefined) => { await clicar(el); await act(() => esperar(50)) }
  let montado = true
  montados.push(() => act(async () => { if (!montado) return; montado = false; root.unmount(); container.remove() }))
  return { clique }
}

test('criar envia só nome, e-mail e senha, já limpos', async () => {
  const { clique } = await montar()
  await digitar(campo(/^Nome$/), '  Fábrica Compras  ')
  await digitar(campo(/^E-mail/), ' Compras@Teste.Invalid ')
  await digitar(campo(/^Senha$/), '12345678')
  await clique(botao('Criar acesso'))
  assert.deepEqual(criar.mock.calls.map(c => c.arguments), [[{ nome: 'Fábrica Compras', email: 'compras@teste.invalid', senha: '12345678' }]])
})

test('criar com senha curta não chama a action e mostra a frase', async () => {
  const { clique } = await montar()
  await digitar(campo(/^Nome$/), 'F')
  await digitar(campo(/^E-mail/), 'a@teste.invalid')
  await digitar(campo(/^Senha$/), '123')
  await clique(botao('Criar acesso'))
  assert.equal(criar.mock.callCount(), 0)
  assert.deepEqual(erros, ['A senha deve ter pelo menos 8 caracteres.'])
})

test('desativar envia o id e o novo estado; recusa da action aparece na tela', async () => {
  alternar.mock.mockImplementationOnce(async () => ({ ok: false, erro: 'Não foi possível mudar o acesso agora. Tente de novo.' }))
  const { clique } = await montar()
  await clique(botao('Desativar'))
  assert.deepEqual(alternar.mock.calls.map(c => c.arguments), [['f-1', false]])
  assert.deepEqual(erros, ['Não foi possível mudar o acesso agora. Tente de novo.'])
})

test('trocar senha envia o id e a senha nova', async () => {
  const { clique } = await montar()
  await clique(botao('Trocar senha'))
  await digitar(campo(/^Nova senha$/), 'nova-senha-1')
  await clique(botao('Salvar senha'))
  assert.deepEqual(redefinir.mock.calls.map(c => c.arguments), [['f-1', 'nova-senha-1']])
})

test('nenhum texto da tela tem travessão', async () => {
  await montar()
  assert.ok(!(document.body.textContent ?? '').includes('—'))
  assert.ok(![...document.querySelectorAll('input')].some(i => (i.placeholder ?? '').includes('—')))
})
