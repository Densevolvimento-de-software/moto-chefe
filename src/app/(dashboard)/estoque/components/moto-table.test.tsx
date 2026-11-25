// Na produção, a nota autorizada fatura a venda e o revalidatePath redesenha o
// Showroom sem a moto, que passou a vendida e o filtro padrão esconde. Aqui a tabela é
// redesenhada assim, e o diálogo da NF aberto tem de continuar o mesmo (nf-saida-contexto).
import { createElement, useState } from 'react'
import test, { after, afterEach, mock } from 'node:test'
import assert from 'node:assert'
import type { MotoComDetalhes } from '@/lib/queries/motos'
import type { PapelDoBanco } from '@/lib/rotulo-do-papel'
import { montarDom } from '@/test/montar-dom'

const { dom, desmontar } = montarDom()
after(desmontar)

// O Link do Next precisa do roteador; para o teste basta um <a>.
mock.module('next/link', { defaultExport: ({ href, children }: { href: string; children: React.ReactNode }) => createElement('a', { href }, children) })
// Os outros botões da linha importam server actions com banco; o teste não passa por eles.
// O Vender vira um marcador para o teste saber em que linha ele aparece e se é só reserva.
mock.module('./vender-button', {
  namedExports: {
    VenderButton: ({ motoId, soReserva }: { motoId: string; soReserva?: boolean }) =>
      createElement('button', { 'data-vender': motoId, 'data-modo': soReserva ? 'reserva' : 'venda' }, 'Vender'),
  },
})
mock.module('./garantia-button', {
  namedExports: {
    GarantiaButton: ({ motoId, motivoBloqueio }: { motoId: string; motivoBloqueio?: string | null }) =>
      createElement('button', { 'data-garantia': motoId, 'data-motivo': motivoBloqueio ?? '' }, 'Garantia'),
  },
})
// O Chegou é o componente de verdade; fica de fora só a action (banco) e o roteador do Next.
mock.module('../[id]/actions', { namedExports: { marcarChegadaAction: async () => ({ ok: true, dados: undefined }) } })
mock.module('next/navigation', { namedExports: { useRouter: () => ({ refresh: () => {} }) } })
for (const [caminho, nome] of [
  ['./montar-button', 'MontarButton'], ['./cancelar-reserva-button', 'CancelarReservaButton'],
]) mock.module(caminho, { namedExports: { [nome]: () => null } })
mock.module('./logistica-button', {
  namedExports: { LogisticaButton: ({ motoId }: { motoId: string }) => createElement('button', { 'data-logistica': motoId }, 'Logística') },
})
// Como o diálogo real: o estado vive no useState; desmontar perde. Conta as montagens para
// separar "continuou" de "desmontou e montou de novo", e o Fechar chama o onFechado.
let montagens = 0
mock.module('./nf-saida-button', {
  namedExports: {
    NfSaidaGatilho: ({ onClick }: { onClick: () => void }) => createElement('button', { 'data-nf': '', onClick }, 'NF Saída'),
    NfSaidaButton: function NfSaidaButton({ motoId, onFechado }: { motoId: string; onFechado?: () => void }) {
      const [n] = useState(() => ++montagens)
      return createElement('div', { 'data-dialogo': motoId },
        createElement('output', { 'data-montagem': '' }, String(n)),
        createElement('button', { 'data-fechar': '', onClick: () => onFechado?.() }, 'Fechar'))
    },
  },
})

const MOTO = {
  id: 'moto-1', modeloId: 'modelo-1', modelo: 'X11-12', chassi: 'LXYTCK0000000013', cor: 'BEGE',
  lojaId: 'loja-1', lojaNome: 'Centro', status: 'vendida', disponibilidade: null, blingNfeId: null,
} as unknown as MotoComDetalhes

async function montar() {
  const React = (await import('react')).default
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { MotoTable } = await import('./moto-table')
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  const desenhar = (motos: MotoComDetalhes[], quem: { papel: PapelDoBanco; lojaUsuarioId: string | null } = { papel: 'admin_socio', lojaUsuarioId: null }) => act(async () => {
    root.render(React.createElement(MotoTable, {
      motos, demandasComSinal: [], papel: quem.papel, vendedorId: 'u1', vendedorNome: 'Sócio', usuarios: [], mecanicos: [],
      lojas: [], lojaUsuarioId: quem.lojaUsuarioId, podeAprovarPagamentoSensivel: false, ord: 'modelo', dir: 'asc', baseParams: '', origens: [],
    }))
  })
  const clicar = (sel: string) => act(async () => { document.querySelector(sel)!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
  const montagem = () => document.querySelector('[data-montagem]')?.textContent ?? null
  let montada = true
  const desmontar = () => act(async () => { if (montada) root.unmount(); montada = false })
  desmontarUltima = desmontar
  return { desenhar, clicar, montagem, desmontar }
}

// Teste que falha no meio não chega ao próprio desmontar; sem isto a tabela dele suja o seguinte.
let desmontarUltima: (() => Promise<void>) | null = null
afterEach(async () => { await desmontarUltima?.(); desmontarUltima = null })

test('o diálogo da NF continua (sem remontar) quando a moto vendida sai da lista', async () => {
  montagens = 0
  const t = await montar()
  await t.desenhar([MOTO])
  await t.clicar('[data-nf]')
  assert.equal(t.montagem(), '1')

  // O Showroom padrão esconde a moto vendida: ela sai da lista.
  await t.desenhar([])
  assert.equal(t.montagem(), '1', 'o mesmo diálogo: não desmontou nem montou de novo')
  assert.equal(document.querySelector('[data-nf]'), null, 'e a linha já não está na tela')
  await t.desmontar()
})

test('ao fechar, o diálogo sai; abrir de novo monta um novo', async () => {
  montagens = 0
  const t = await montar()
  await t.desenhar([MOTO])
  await t.clicar('[data-nf]')
  await t.clicar('[data-fechar]')
  assert.equal(document.querySelector('[data-dialogo]'), null, 'onFechado limpa a moto aberta')
  await t.clicar('[data-nf]')
  assert.equal(t.montagem(), '2')
  await t.desmontar()
})

test('Vender: montada disponível e garantia vendem; moto em caixa não vende, só reserva sem disponibilidade (#941)', async () => {
  const t = await montar()
  const linha = (id: string, status: string, disponibilidade: string | null) => ({ ...MOTO, id, chassi: `LXYTCK00000000${id}`, status, disponibilidade }) as unknown as MotoComDetalhes
  await t.desenhar([
    linha('m1', 'montada', 'disponivel'),
    linha('m2', 'em_garantia', null),
    linha('m3', 'caixa', 'disponivel'),
    linha('m4', 'caixa', null),
    linha('m5', 'montada', 'reservada'),
  ])
  const linhasCom = (modo: string) => [...document.querySelectorAll(`[data-modo=${modo}]`)].map(b => b.getAttribute('data-vender'))
  assert.deepEqual(linhasCom('venda'), ['m1', 'm2'])
  assert.deepEqual(linhasCom('reserva'), ['m4'])
  await t.desmontar()
})

test('em transporte não vende nem transfere; reservada que não vende fica sem o Vender de finalizar, com o Comprovante (#9)', async () => {
  const t = await montar()
  const linha = (id: string, status: string, disponibilidade: string | null) => ({ ...MOTO, id, chassi: `LXYTCK00000000${id}`, status, disponibilidade }) as unknown as MotoComDetalhes
  const reservada = (id: string, status: string) => ({ ...linha(id, status, 'reservada'), reservaId: `r-${id}`, reservaValorEntrada: '300' }) as unknown as MotoComDetalhes
  await t.desenhar([
    linha('e1', 'em_transporte', 'disponivel'),
    linha('e2', 'em_transporte', null),
    reservada('e3', 'em_transporte'),
    reservada('c1', 'caixa'),
    linha('m1', 'montada', 'disponivel'),
    reservada('m2', 'montada'),
  ])
  const ids = (sel: string, attr: string) => [...document.querySelectorAll(sel)].map(b => b.getAttribute(attr))
  assert.deepEqual(ids('[data-modo=venda]', 'data-vender'), ['m1', 'm2'])
  assert.deepEqual(ids('[data-logistica]', 'data-logistica'), ['c1', 'm1', 'm2'])
  assert.deepEqual(ids('a[href^="/reservas/"]', 'href'), ['/reservas/r-e3/imprimir', '/reservas/r-c1/imprimir', '/reservas/r-m2/imprimir'])
  await t.desmontar()
})

test('Reservar na lista: em transporte sem disponibilidade só reserva, como a caixa; a já reservada não reserva de novo (#12)', async () => {
  const t = await montar()
  const linha = (id: string, status: string, disponibilidade: string | null) => ({ ...MOTO, id, chassi: `LXYTCK00000000${id}`, status, disponibilidade }) as unknown as MotoComDetalhes
  await t.desenhar([
    linha('e1', 'em_transporte', null),
    linha('e2', 'em_transporte', 'reservada'),
    linha('c1', 'caixa', null),
    linha('m1', 'montada', 'disponivel'),
  ])
  const linhasCom = (modo: string) => [...document.querySelectorAll(`[data-modo=${modo}]`)].map(b => b.getAttribute('data-vender'))
  assert.deepEqual(linhasCom('reserva'), ['e1', 'c1'])
  assert.deepEqual(linhasCom('venda'), ['m1'])
  await t.desmontar()
})

test('Garantia na lista: motivo na moto em transporte e na caixa; montada e em garantia abrem (#9)', async () => {
  const t = await montar()
  const linha = (id: string, status: string) => ({ ...MOTO, id, chassi: `LXYTCK00000000${id}`, status, disponibilidade: null }) as unknown as MotoComDetalhes
  await t.desenhar([linha('e1', 'em_transporte'), linha('c1', 'caixa'), linha('m1', 'montada'), linha('g1', 'em_garantia')])
  const motivos = Object.fromEntries([...document.querySelectorAll('[data-garantia]')].map(b => [b.getAttribute('data-garantia'), b.getAttribute('data-motivo')]))
  assert.deepEqual(motivos, {
    e1: 'Moto ainda em transporte. Garantia só depois da chegada.',
    c1: 'Moto ainda não foi montada. Garantia só depois da montagem.',
    m1: '', g1: '',
  })
  await t.desmontar()
})

test('a tabela é Server Component: as demandas (com dados de cliente) não vão inteiras ao navegador', async () => {
  const { readFileSync } = await import('node:fs')
  const { join } = await import('node:path')
  const dir = join(process.cwd(), 'src/app/(dashboard)/estoque/components')
  const tabela = readFileSync(join(dir, 'moto-table.tsx'), 'utf8')
  assert.doesNotMatch(tabela, /^\s*['"]use client['"]/, 'moto-table.tsx sem use client')
  // O pedaço client do diálogo só recebe a moto aberta: nem demandas nem a lista de motos.
  const contexto = readFileSync(join(dir, 'nf-saida-contexto.tsx'), 'utf8')
  assert.match(contexto, /export function NfSaidaProvider\(\{ children \}: \{ children: React\.ReactNode \}\)/)
  assert.match(contexto, /type MotoDaNf = \{ motoId: string; descricao: string; blingNfeId: string \| null \}/)
})

// Quem vê o Chegou na lista (#277): a mesma regra do servidor e da página da moto (motivoParaNaoMarcarChegada), de verdade.
const linhaDe = (id: string, status: string, extra: object = {}) =>
  ({ ...MOTO, id, chassi: `LXYTCK00000000${id}`, status, disponibilidade: null, arquivadaEm: null, ...extra }) as unknown as MotoComDetalhes
/** Chassis das linhas que têm o botão Chegou. */
const linhasComChegou = () =>
  [...document.querySelectorAll('tbody tr')]
    .filter(tr => tr.querySelector('button[aria-label^="Chegou: "]'))
    .map(tr => (tr.textContent ?? '').match(/LXYTCK00000000[a-z]\d/)?.[0])

test('Chegou na lista: só na linha em transporte e só para quem a regra deixa marcar', async () => {
  const t = await montar()
  const emTransporte = [linhaDe('t1', 'em_transporte')]
  const casos: [string, { papel: PapelDoBanco; lojaUsuarioId: string | null }, string[]][] = [
    ['aux_adm da loja da moto', { papel: 'aux_adm', lojaUsuarioId: 'loja-1' }, ['LXYTCK00000000t1']],
    ['admin_socio de outra loja', { papel: 'admin_socio', lojaUsuarioId: 'loja-2' }, ['LXYTCK00000000t1']],
    ['admin_geral de outra loja', { papel: 'admin_geral', lojaUsuarioId: 'loja-2' }, ['LXYTCK00000000t1']],
    ['aux_adm de outra loja da Conta', { papel: 'aux_adm', lojaUsuarioId: 'loja-2' }, []],
    ['vendedor da loja da moto', { papel: 'vendedor', lojaUsuarioId: 'loja-1' }, []],
  ]
  for (const [rotulo, quem, esperado] of casos) {
    await t.desenhar(emTransporte, quem)
    assert.deepEqual(linhasComChegou(), esperado, rotulo)
  }
  await t.desmontar()
})

test('Chegou na lista: moto em outro status ou arquivada não mostra o botão', async () => {
  const t = await montar()
  await t.desenhar([
    linhaDe('t1', 'em_transporte'),
    linhaDe('t2', 'em_transporte', { arquivadaEm: new Date('2026-11-01') }),
    linhaDe('c1', 'caixa'),
    linhaDe('m1', 'montada', { disponibilidade: 'disponivel' }),
    linhaDe('g1', 'em_garantia'),
    linhaDe('v1', 'vendida'),
  ])
  assert.deepEqual(linhasComChegou(), ['LXYTCK00000000t1'])
  await t.desmontar()
})
