// Detalhe da moto (#941, #9): moto que não vende (caixa, em transporte) aberta com ?vender=1 mostra o
// aviso do seu status e nenhum Vender; montada disponível mostra Vender e nenhum aviso. Em transporte não
// mostra Logística; reservada que não vende não mostra o Vender de finalizar a reserva.
import { createElement } from 'react'
import test, { after, afterEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import { montarDom } from '@/test/montar-dom'

const { desmontar: desmontarDom } = montarDom()
const nulo = () => null
const mocks = [
  mock.module('next/navigation', {
    namedExports: {
      useSearchParams: () => new URLSearchParams('vender=1'),
      useRouter: () => ({ replace: () => {} }),
      usePathname: () => '/estoque/moto-1',
    },
  }),
  // Os botões importam server actions com banco; o teste só quer saber se o Vender aparece.
  mock.module('../../components/vender-button', {
    namedExports: { VenderButton: ({ soReserva }: { soReserva?: boolean }) => createElement('button', { 'data-vender': soReserva ? 'reserva' : 'venda' }, 'Vender') },
  }),
  mock.module('../../components/garantia-button', { namedExports: { GarantiaButton: nulo } }),
  mock.module('../../components/logistica-button', { namedExports: { LogisticaButton: () => createElement('button', { 'data-logistica': '' }, 'Logística') } }),
  mock.module('../../components/nf-saida-button', { namedExports: { NfSaidaButton: nulo } }),
  mock.module('../../components/montar-button', { namedExports: { MontarButton: nulo } }),
  mock.module('../../components/cancelar-reserva-button', { namedExports: { CancelarReservaButton: nulo } }),
  mock.module('./resolver-garantia-button', { namedExports: { ResolverGarantiaButton: nulo } }),
]
after(() => { mocks.forEach(m => m.restore()); desmontarDom() })

const montados: (() => Promise<void>)[] = []
afterEach(async () => { for (const desmontar of montados.splice(0)) await desmontar() })

const MOTO = {
  id: 'moto-1', lojaId: 'loja-1', lojaNome: 'Centro', marca: 'M', modelo: 'JET', cor: 'PRETO',
  transferenciaPendente: false, transferenciaDestino: null, reservaId: null, reservaValorEntrada: null,
  reservaValorTotal: null, reservaClienteNome: null, reservaClienteCpf: null, reservaClienteCelular: null,
  reservaClienteEmail: null, reservaClienteCep: null, reservaClienteLogradouro: null, reservaClienteNumero: null,
  reservaClienteComplemento: null, reservaClienteBairro: null, reservaClienteCidade: null, reservaClienteEstado: null,
  reservaVendedorId: null, reservaMeioPagamento: null, reservaCartaoOperadora: null, reservaCartaoParcelas: null,
  reservaPagamentos: null,
}

async function montar(status: string, disponibilidade: string | null, reserva: { reservaId?: string; reservaValorEntrada?: string } = {}) {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { MotoActions } = await import('./moto-actions')
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(createElement(MotoActions, {
      moto: { ...MOTO, ...reserva, status, disponibilidade }, papel: 'aux_adm', vendedorId: 'u1', vendedorNome: 'Aux',
      usuarios: [], mecanicos: [], lojas: [], lojaUsuarioId: 'loja-1', precoMinimoPix: null, taxasVenda: null,
      podeAprovarPagamentoSensivel: false, origens: [],
    }))
  })
  montados.push(() => act(async () => { root.unmount(); container.remove() }))
  return {
    // Título e texto do aviso, ou null sem aviso.
    aviso: () => {
      const aviso = container.querySelector('[role=status]')
      return aviso ? [...aviso.querySelectorAll('p')].map(p => p.textContent) : null
    },
    vender: () => [...container.querySelectorAll('[data-vender]')].map(b => b.getAttribute('data-vender')),
    logistica: () => container.querySelector('[data-logistica]') !== null,
    comprovante: () => container.querySelector('a[href="/reservas/r1/imprimir"]') !== null,
  }
}

test('moto na caixa com ?vender=1: aviso da caixa e nenhum Vender de venda', async () => {
  const t = await montar('caixa', 'disponivel')
  assert.deepEqual(t.aviso(), ['A moto voltou ao estoque, mas ainda está em caixa', 'Moto em caixa não pode ser vendida. Use o botão Montar e depois o Vender.'])
  assert.deepEqual(t.vender(), [])
})

test('moto em transporte com ?vender=1: aviso do transporte, nenhum Vender e nenhuma Logística', async () => {
  const t = await montar('em_transporte', 'disponivel')
  assert.deepEqual(t.aviso(), ['A moto voltou ao estoque, mas ainda está em transporte', 'Moto em transporte não pode ser vendida. Marque a chegada, monte e depois venda.'])
  assert.deepEqual(t.vender(), [])
  assert.equal(t.logistica(), false)
})

test('moto montada disponível com ?vender=1: Vender e Logística aparecem, sem aviso', async () => {
  const t = await montar('montada', 'disponivel')
  assert.equal(t.aviso(), null)
  assert.deepEqual(t.vender(), ['venda'])
  assert.equal(t.logistica(), true)
})

// D4 (#9): o servidor recusa a venda dessas motos; a tela não oferece o botão que sempre falharia.
test('reservada na caixa ou em transporte: sem o Vender de finalizar a reserva, com o Comprovante; montada reservada continua com o Vender', async () => {
  const reservada = { reservaId: 'r1', reservaValorEntrada: '300' }
  for (const status of ['caixa', 'em_transporte']) {
    const t = await montar(status, 'reservada', reservada)
    assert.deepEqual(t.vender(), [], status)
    assert.equal(t.comprovante(), true, status)
  }
  assert.deepEqual((await montar('montada', 'reservada', reservada)).vender(), ['venda'])
})
