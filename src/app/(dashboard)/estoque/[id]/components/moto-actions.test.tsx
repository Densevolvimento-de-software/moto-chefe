// Detalhe da moto (#941): moto na caixa aberta com ?vender=1 mostra o aviso e não mostra Vender;
// montada disponível mostra Vender e nenhum aviso.
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
  mock.module('../../components/logistica-button', { namedExports: { LogisticaButton: nulo } }),
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

async function montar(status: string, disponibilidade: string | null) {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { MotoActions } = await import('./moto-actions')
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(createElement(MotoActions, {
      moto: { ...MOTO, status, disponibilidade }, papel: 'aux_adm', vendedorId: 'u1', vendedorNome: 'Aux',
      usuarios: [], mecanicos: [], lojas: [], lojaUsuarioId: 'loja-1', precoMinimoPix: null, taxasVenda: null,
      podeAprovarPagamentoSensivel: false, origens: [],
    }))
  })
  montados.push(() => act(async () => { root.unmount(); container.remove() }))
  return {
    aviso: () => container.textContent?.includes('ainda está em caixa') ?? false,
    vender: () => [...container.querySelectorAll('[data-vender]')].map(b => b.getAttribute('data-vender')),
  }
}

test('moto na caixa com ?vender=1: aviso de que não vende e nenhum Vender de venda', async () => {
  const t = await montar('caixa', 'disponivel')
  assert.equal(t.aviso(), true)
  assert.deepEqual(t.vender(), [])
})

test('moto montada disponível com ?vender=1: Vender aparece e não há aviso', async () => {
  const t = await montar('montada', 'disponivel')
  assert.equal(t.aviso(), false)
  assert.deepEqual(t.vender(), ['venda'])
})
