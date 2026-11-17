// Contagem dos cards do Showroom (/estoque). A moto conta no card do status e no da disponibilidade.
import { STATUS_DE_ESTOQUE, type StatusDeEstoque } from './status-moto'

type Moto = { status: string; disponibilidade: string | null }

const quantas = (motos: readonly Moto[], conta: (m: Moto) => boolean) => motos.filter(conta).length

export function contarCardsDoShowroom(motos: readonly Moto[]) {
  const porStatus = Object.fromEntries(
    STATUS_DE_ESTOQUE.map(s => [s.valor, quantas(motos, m => m.status === s.valor)]),
  ) as Record<StatusDeEstoque, number>
  return {
    total:         motos.length,
    ...porStatus,
    disponivel:    quantas(motos, m => m.disponibilidade === 'disponivel'),
    reservada:     quantas(motos, m => m.disponibilidade === 'reservada'),
    // Vendida que ainda aparece no Showroom: falta a NF de saída.
    aguardando_nf: quantas(motos, m => m.status === 'vendida'),
  }
}

export type ContagemShowroom = ReturnType<typeof contarCardsDoShowroom>
