// Painel de conciliação da OS (#90): a dica de PIX pendente some quando o PIX vinculado cobre o
// pagamento pelo valor do PIX, mesmo que o banco tenha creditado sem o custo. As actions são a fronteira de fora.
import test, { after, afterEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import { montarDom } from '@/test/montar-dom'
import { esperar, montarDialogo, textoDaTela } from '@/test/dialogo-em-tela'
import { createElement, type ReactNode } from 'react'

const { desmontar: desmontarDom } = montarDom()
after(desmontarDom)

type PixDoAlvo = { id: string; dataPagamento: Date; valor: string; pagadorNome: string | null; observacao: string | null; valorBruto: string | null; custoPix: string | null; custoPixTaxa: string | null }
const pixDoAlvo = mock.fn(async (): Promise<PixDoAlvo[]> => [])
const actionsMock = mock.module('@/app/(dashboard)/conciliacao/actions', { namedExports: {
  buscarPixDoAlvo: () => pixDoAlvo(),
  buscarConciliacoesDoAlvo: async () => [],
  buscarEstornosDoAlvo: async () => [],
  buscarCoberturaDoPedido: async () => null,
  buscarConciliacoesPorValor: async () => [],
  buscarConciliacoesLivres: async () => [],
  buscarPixLivres: async () => [],
  vincularVendaAction: async () => ({ ok: true, dados: undefined }),
  vincularPixAlvoAction: async () => ({ ok: true, dados: undefined }),
  forcarConciliacaoAction: async () => ({ ok: true, dados: undefined }),
  desfazerConciliacaoForcadaAction: async () => ({ ok: true, dados: undefined }),
  buscarPixParaOAlvo: async () => ({ esperado: null, noGrupoAtivo: true, pix: [] }),
} })
const linkMock = mock.module('next/link', { defaultExport: ({ href, children }: { href: string; children: ReactNode }) => createElement('a', { href }, children) })
after(() => { actionsMock.restore(); linkMock.restore() })

const desmontagens: (() => Promise<void>)[] = []
afterEach(async () => {
  pixDoAlvo.mock.restore()
  for (const desmontar of desmontagens.splice(0)) await desmontar()
})

// A dica aponta o próprio painel (maquininha ou banco) desde o #51 (PR6c).
const DICA = 'PIX pendente: toque no pagamento acima'
const pix = (valor: string, valorBruto: string | null): PixDoAlvo =>
  ({ id: 'p1', dataPagamento: new Date('2026-11-12T14:32:00Z'), valor, pagadorNome: 'Pagador Exemplo', observacao: null, valorBruto, custoPix: null, custoPixTaxa: null })

async function montar() {
  const { OSConciliacaoPanel } = await import('./os-conciliacao-panel')
  const tela = await montarDialogo(OSConciliacaoPanel, { osId: '2c9d47e2-c479-42bf-9372-f7a34308299f', pagamentos: [{ tipo: 'pix', valor: 10000 }], papel: 'aux_adm', podeForcar: true })
  desmontagens.push(tela.desmontar)
  await tela.act(() => esperar(50))
}

test('PIX creditado R$ 9.980,00 com valor do PIX R$ 10.000,00 cobre o pagamento: sem a dica de PIX pendente', async () => {
  pixDoAlvo.mock.mockImplementation(async () => [pix('9980.00', '10000.00')])
  await montar()
  assert.ok(textoDaTela().includes('Todos os pagamentos estão conciliados'), 'o painel carregou e fechou a linha')
  assert.equal(textoDaTela().includes(DICA), false)
})

test('PIX vinculado antes do custo, creditado a menos, segue pendente: a dica aparece', async () => {
  pixDoAlvo.mock.mockImplementation(async () => [pix('9980.00', null)])
  await montar()
  assert.ok(textoDaTela().includes('Parcial'), 'o painel carregou com a linha parcial')
  assert.equal(textoDaTela().includes(DICA), true)
})
