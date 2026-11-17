import type { NovidadeDaVersao } from '../tipos'

const novidade: NovidadeDaVersao = {
  versao: '1.38.0',
  data: '2026-11-17',
  novidades: [
    {
      titulo: 'Moto em transporte',
      texto: 'Na entrada da nota, a moto pode ser registrada como "Em transporte" quando ainda não chegou na loja. Ela aparece no estoque com esse selo e não pode ser vendida, montada nem transferida até chegar.',
    },
    {
      titulo: 'Botão Chegou',
      texto: 'Quando a moto chega, o aux. administrativo da loja marca a chegada no botão "Chegou" e ela passa para Caixa, com o registro de quem marcou no histórico.',
    },
    {
      titulo: 'Em transporte no Showroom',
      texto: 'O Showroom ganhou o card "Em transporte" com a quantidade de motos a caminho, e uma moto em transporte já pode ser reservada para o cliente.',
    },
  ],
}

export default novidade
