import type { NovidadeDaVersao } from '../tipos'

const novidade: NovidadeDaVersao = {
  versao: '1.42.2',
  data: '2026-11-24',
  correcoes: [
    {
      titulo: 'PIX da InfinitePay na conciliação',
      texto: 'Ao importar na Conciliação o relatório de PIX da InfinitePay, as linhas de PIX aprovadas agora entram e podem ser vinculadas à venda. Antes, o arquivo era lido, mas nenhuma linha de PIX era importada.',
    },
  ],
}

export default novidade
