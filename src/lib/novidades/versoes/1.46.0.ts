import type { NovidadeDaVersao } from '../tipos'

const novidade: NovidadeDaVersao = {
  versao: '1.46.0',
  data: '2026-11-26',
  novidades: [
    {
      titulo: 'Responsável pela venda de peças',
      texto: 'Ao criar uma venda de peças, sócios e auxiliares administrativos escolhem quem é o responsável pela venda, entre as pessoas da empresa que vendem peças. Sem escolher, a venda sai no nome de quem registrou, como antes.',
    },
  ],
  correcoes: [
    {
      titulo: 'Caixa da venda de peças editada',
      texto: 'Ao editar uma venda de peças paga em dinheiro, o lançamento de caixa continua no nome do responsável pela venda, e não de quem fez a edição.',
    },
  ],
}

export default novidade
