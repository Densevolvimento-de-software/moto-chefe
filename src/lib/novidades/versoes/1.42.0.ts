import type { NovidadeDaVersao } from '../tipos'

const novidade: NovidadeDaVersao = {
  versao: '1.42.0',
  data: '2026-11-24',
  novidades: [
    {
      titulo: 'Mercado Pago aparece como integração',
      texto: 'Em Maquininhas e na Conciliação, a maquininha Mercado Pago passa a aparecer como "Integração", porque as vendas dela entram sozinhas pelo token cadastrado. Se o grupo ainda não cadastrou o token, a tela avisa onde cadastrar.',
    },
    {
      titulo: 'PIX de outras contas do mesmo dono',
      texto: 'A tela PIX pode trazer também os PIX de outra conta bancária do mesmo dono, com outro CNPJ, ligada ao Open Finance. Quem quiser incluir uma conta pede ao suporte do MOVA.',
    },
  ],
}

export default novidade
