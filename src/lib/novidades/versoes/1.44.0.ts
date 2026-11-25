import type { NovidadeDaVersao } from '../tipos'

const novidade: NovidadeDaVersao = {
  versao: '1.44.0',
  data: '2026-11-25',
  novidades: [
    {
      titulo: 'Troca de vendedor fica no histórico',
      texto: 'Quando um sócio troca o vendedor de uma venda concluída, o MOVA registra a mudança no log de ações, com o vendedor anterior, o novo e quem fez a alteração.',
    },
  ],
  correcoes: [
    {
      titulo: 'Conciliação reconhece saldo e cartão pré-pago',
      texto: 'Pagamentos da Point feitos com saldo Mercado Pago agora aparecem em uma linha própria, separada do Pix. O cartão pré-pago entra como crédito.',
    },
  ],
}

export default novidade
