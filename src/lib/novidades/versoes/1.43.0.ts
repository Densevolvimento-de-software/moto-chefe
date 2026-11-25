import type { NovidadeDaVersao } from '../tipos'

const novidade: NovidadeDaVersao = {
  versao: '1.43.0',
  data: '2026-11-24',
  novidades: [
    {
      titulo: 'Administrador da rede marca a chegada da moto',
      texto: 'Quem administra a rede agora também vê o botão "Chegou" na moto Em transporte e marca a chegada dela, como o sócio já fazia. O histórico da moto guarda quem marcou.',
    },
  ],
  correcoes: [
    {
      titulo: 'Nota recusada: DIFAL acompanha o comprador corrigido',
      texto: 'Ao corrigir o estado ou o tipo de contribuinte do comprador numa nota recusada, a tela passa a mostrar ou esconder o campo da alíquota do DIFAL na hora. Antes, o reenvio podia ser recusado pedindo um campo que não aparecia.',
    },
  ],
}

export default novidade
