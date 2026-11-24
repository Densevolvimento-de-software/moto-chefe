import type { NovidadeDaVersao } from '../tipos'

const novidade: NovidadeDaVersao = {
  versao: '1.42.1',
  data: '2026-11-24',
  correcoes: [
    {
      titulo: 'Nota para outro estado, para quem não contribui com ICMS',
      texto: 'Ao emitir a NF-e de uma venda para fora do estado, para quem não contribui com ICMS, o MOVA passa a pedir a alíquota interna do estado do comprador (e o FCP, se houver) e envia o DIFAL na nota. Antes, a SEFAZ recusava a nota.',
    },
  ],
}

export default novidade
