import type { NovidadeDaVersao } from '../tipos'

const novidade: NovidadeDaVersao = {
  versao: '1.45.0',
  data: '2026-11-26',
  novidades: [
    {
      titulo: 'Botão "Chegou" direto na lista do Showroom',
      texto: 'A moto Em transporte ganhou o botão "Chegou" na própria linha da lista. Um clique marca a chegada, sem precisar abrir a moto.',
    },
    {
      titulo: 'Entrada mínima da reserva por loja',
      texto: 'Os sócios escolhem, na Precificação, a porcentagem de entrada mínima para reservar uma moto em cada loja. Antes eram 30% do preço mínimo no PIX para todas.',
    },
    {
      titulo: 'Cada empresa com o seu catálogo de serviços',
      texto: 'Os serviços que a sua empresa já usou em OS continuam na lista, e os sócios cadastram, ajustam e inativam os serviços na tela Serviços. Empresa que ainda não usou nenhum serviço começa com a lista vazia.',
    },
  ],
  correcoes: [
    {
      titulo: 'Aviso claro quando a sessão acaba',
      texto: 'Com a sessão vencida, clicar em um botão como Chegou, vender ou reservar agora mostra o aviso para entrar de novo, no lugar de uma mensagem de erro.',
    },
    {
      titulo: 'OS guarda o nome do serviço',
      texto: 'O resumo da OS mostra o nome do serviço como foi lançado, mesmo que o serviço seja renomeado ou inativado depois.',
    },
  ],
}

export default novidade
