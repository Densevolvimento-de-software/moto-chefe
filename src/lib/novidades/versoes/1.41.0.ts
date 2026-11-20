import type { NovidadeDaVersao } from '../tipos'

const novidade: NovidadeDaVersao = {
  versao: '1.41.0',
  data: '2026-11-20',
  novidades: [
    {
      titulo: 'Custo do PIX na Precificação',
      texto: 'Na Precificação há uma aba nova, PIX, antes de Cartão de Crédito. Nela o sócio informa quanto o banco cobra sobre cada PIX recebido, em porcentagem (por exemplo, 0,20%). Cada grupo tem o seu valor. O grupo que não preencher continua como antes, sem custo.',
    },
    {
      titulo: 'Conciliação do PIX com o custo',
      texto: 'O banco já deposita o PIX com o custo descontado. Ao vincular um PIX a uma venda, o MOVA calcula o valor cheio e o custo: um crédito de R$ 9.980,00 com custo de 0,20% vira um PIX de R$ 10.000,00 com R$ 20,00 de custo. A busca de PIX para vincular já procura pelo valor que deve ter entrado. O custo fica guardado com a taxa daquele dia: mudar a porcentagem depois não muda o que já foi conciliado.',
    },
    {
      titulo: 'Marcar PIX como recebido pede o valor que entrou',
      texto: 'Ao usar "Forçar" num pagamento PIX, informe quanto entrou de fato na conta. A diferença para o valor do pagamento vira o custo do PIX. Se esse custo passar de 1%, o MOVA avisa para conferir o valor digitado, mas deixa gravar. Se alguém vincular ou desvincular um PIX daquele pagamento enquanto você preenche, o MOVA pede para conferir e marcar de novo.',
    },
    {
      titulo: 'Desfazer a marcação e desvincular o PIX',
      texto: 'Quando um PIX completa um pagamento que foi marcado como recebido em parte, desvincular esse PIX pede antes para desfazer a marcação. Quem cuida da conciliação (sócio e aux. administrativo) vê uma caixa explicando os valores e confirma "Desfazer a forçada e desvincular", na tela de PIX e na conciliação de cartão (PIX da maquininha). O vendedor vê a mesma explicação e pede a quem cuida da conciliação.',
    },
    {
      titulo: 'O líquido da venda desconta o custo do PIX',
      texto: 'O valor líquido das vendas de moto, ordens de serviço e vendas de peças passa a descontar o custo do PIX conciliado, como já desconta a taxa do cartão. Aparece em Detalhes da venda (linha "Custo do PIX"), no Financeiro (card "Custo PIX", separado de "Taxas Cartão"), no DRE (linha "Custo do PIX") e no fechamento. PIX ainda não conciliado entra pelo valor cheio.',
    },
    {
      titulo: 'PIX ligado ao pedido',
      texto: 'O custo de um PIX ligado ao pedido entra uma vez só, na venda do pedido. Se essa venda também tiver um pagamento PIX marcado como recebido, a parte já coberta pelo PIX do pedido não é contada de novo; se o PIX for desligado do pedido, o custo da marcação volta a contar. A aba Pagamento da venda mostra o custo que de fato conta.',
    },
    {
      titulo: 'Simulador e comissão',
      texto: 'O simulador de preço mostra o custo do PIX só como informação para a loja: o preço mínimo não muda. A comissão dos vendedores continua calculada como antes, sem descontar o custo do PIX; o painel do vendedor mostra os números da comissão.',
    },
  ],
}

export default novidade
