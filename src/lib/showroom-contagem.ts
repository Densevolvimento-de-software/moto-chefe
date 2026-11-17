// Contagem dos cards do Showroom (/estoque). A moto conta no card do status e no da disponibilidade.

type Moto = { status: string; disponibilidade: string | null }

const quantas = (motos: readonly Moto[], conta: (m: Moto) => boolean) => motos.filter(conta).length

export function contarCardsDoShowroom(motos: readonly Moto[]) {
  return {
    total:         motos.length,
    em_transporte: quantas(motos, m => m.status === 'em_transporte'),
    caixa:         quantas(motos, m => m.status === 'caixa'),
    montada:       quantas(motos, m => m.status === 'montada'),
    disponivel:    quantas(motos, m => m.disponibilidade === 'disponivel'),
    reservada:     quantas(motos, m => m.disponibilidade === 'reservada'),
    em_garantia:   quantas(motos, m => m.status === 'em_garantia'),
    // Vendida que ainda aparece no Showroom: falta a NF de saída.
    aguardando_nf: quantas(motos, m => m.status === 'vendida'),
  }
}

export type ContagemShowroom = ReturnType<typeof contarCardsDoShowroom>
