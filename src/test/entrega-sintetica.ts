import type { EntregaVenda } from '@/lib/notagateway/entrega'
import type { ModalidadeFrete } from '@/lib/notagateway/transporte'

/**
 * "Entregar" num endereço sintético de São Paulo, com o comprador recebendo; frete ausente = sem frete cobrado.
 * Por padrão a loja leva a moto, a modalidade em que o frete cobrado vale.
 */
export const entregarSintetico = (frete?: number, modalidade: ModalidadeFrete = 'TransporteProprioPorContaDoRemetente'): EntregaVenda => ({
  modo: 'entregar', modalidade, recebe: null,
  endereco: { cep: '01001000', logradouro: 'Rua Sintética', numero: '1', complemento: '', bairro: 'Centro', cidade: '3550308', nomeCidade: 'São Paulo', uf: 'SP' },
  ...(frete ? { frete } : {}),
})
