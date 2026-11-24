// Cadastro de maquininhas (#205): o Mercado Pago aparece como integração, com ou sem token do grupo;
// as operadoras de antes seguem como estavam (relatório ou manual).
import { test, after, afterEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import { montarDom } from '@/test/montar-dom'
import { montarDialogo, clicar, esperar, textoDaTela } from '@/test/dialogo-em-tela'

const { desmontar } = montarDom()
after(desmontar)

mock.module('../actions', {
  namedExports: {
    criarMaquininhaAction: async () => ({ ok: true }),
    editarMaquininhaAction: async () => ({ ok: true }),
    definirMaquininhaAtivaAction: async () => ({ ok: true }),
  },
})

const MERCADO_PAGO = { id: 'mp', nome: 'Point loja', operadora: 'mercadopago', ativo: true }
const STONE = { id: 'st', nome: 'Stone loja', operadora: 'stone', ativo: true }
const GETNET = { id: 'gn', nome: 'GetNet loja', operadora: 'getnet', ativo: true }

const FRASE_CAIXA_COM_TOKEN = 'Importada pela integração do Mercado Pago.'
const FRASE_SEM_TOKEN = 'Cadastre o token do Mercado Pago em Grupos para importar.'
const AVISO_MANUAL = 'A conciliação desta maquininha é manual: o relatório dela não é importado.'

const linhaDa = (nome: string) => [...document.querySelectorAll('tbody tr')].find(tr => (tr.textContent ?? '').includes(nome))
// Coluna 2 da tabela é a "Conciliação".
const celulaConciliacao = (nome: string) => linhaDa(nome)!.children[2] as HTMLElement
const textoDaCelula = (nome: string) => (celulaConciliacao(nome).textContent ?? '').trim()

const montados: (() => Promise<void>)[] = []
afterEach(async () => { for (const d of montados.splice(0)) await d(); document.body.innerHTML = '' })

async function abrirEdicaoDe(nome: string, act: typeof import('react').act) {
  const botaoEditar = linhaDa(nome)!.querySelector('button[title="Editar"]')
  await act(async () => { clicar(botaoEditar); await esperar(50) })
}

test('Mercado Pago com token: coluna "Integração"; caixa do Editar diz que vem pela integração', async () => {
  const { MaquininhasTable } = await import('./maquininhas-table')
  const tela = await montarDialogo(MaquininhasTable, { maquininhas: [MERCADO_PAGO], temCredencialMp: true })
  montados.push(tela.desmontar)
  assert.equal(textoDaCelula('Point loja'), 'Integração')
  await abrirEdicaoDe('Point loja', tela.act)
  assert.deepEqual([textoDaTela().includes(FRASE_CAIXA_COM_TOKEN), textoDaTela().includes(AVISO_MANUAL)], [true, false])
})

test('Mercado Pago sem token no grupo: coluna "Integração sem token" e caixa manda cadastrar o token', async () => {
  const { MaquininhasTable } = await import('./maquininhas-table')
  const tela = await montarDialogo(MaquininhasTable, { maquininhas: [MERCADO_PAGO], temCredencialMp: false })
  montados.push(tela.desmontar)
  assert.equal(textoDaCelula('Point loja'), 'Integração sem token')
  assert.equal(celulaConciliacao('Point loja').title, FRASE_SEM_TOKEN)
  await abrirEdicaoDe('Point loja', tela.act)
  assert.equal(textoDaTela().includes(FRASE_SEM_TOKEN), true)
})

test('operadoras de antes não mudam: Stone "Importa relatório"; GetNet "Manual" com o aviso (#205)', async () => {
  const { MaquininhasTable } = await import('./maquininhas-table')
  const tela = await montarDialogo(MaquininhasTable, { maquininhas: [STONE, GETNET], temCredencialMp: false })
  montados.push(tela.desmontar)
  assert.deepEqual([textoDaCelula('Stone loja'), textoDaCelula('GetNet loja')], ['Importa relatório', 'Manual'])
  assert.equal(celulaConciliacao('GetNet loja').title, AVISO_MANUAL)
})
