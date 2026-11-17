import type { NovidadeDaVersao } from '../tipos'

const novidade: NovidadeDaVersao = {
  versao: '1.38.1',
  data: '2026-11-17',
  correcoes: [
    {
      titulo: 'Taxa do cartão no simulador',
      texto: 'O simulador agora calcula o valor no cartão de crédito, no débito e no link de forma que, depois de descontada a taxa da maquininha, a loja receba o valor mínimo do modelo. Por exemplo, com taxa de 9%, para a loja receber R$ 10.000 o cartão fica em R$ 10.989,01. No parcelado, cada parcela é arredondada para cima no centavo: em 12x, R$ 915,76 por mês (R$ 10.989,12 no total).',
    },
    {
      titulo: 'Valor mínimo na venda com cartão',
      texto: 'Na venda com cartão de crédito, débito ou link, o valor que a loja recebe agora desconta a taxa da maquininha sobre o valor cobrado. Algumas vendas no cartão que antes passavam podem pedir aprovação de valor mínimo.',
    },
  ],
}

export default novidade
