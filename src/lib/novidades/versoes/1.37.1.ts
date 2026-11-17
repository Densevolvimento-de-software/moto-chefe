import type { NovidadeDaVersao } from '../tipos'

const novidade: NovidadeDaVersao = {
  versao: '1.37.1',
  data: '2026-11-17',
  correcoes: [
    {
      titulo: 'Corrigir NF recusada de outra loja',
      texto: 'Quem pode emitir a NF de uma venda feita em outra loja agora também consegue corrigir e reenviar essa NF quando ela é recusada, sem a mensagem "Venda não encontrada".',
    },
    {
      titulo: 'NF recusada por falta de CEST',
      texto: 'Quando a SEFAZ recusa a NF porque falta o CEST da moto, a tela de correção agora explica isso e abre só os dados da moto para corrigir.',
    },
  ],
}

export default novidade
