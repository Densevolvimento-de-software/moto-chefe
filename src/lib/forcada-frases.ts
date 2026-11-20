// As frases da forçada parcial de PIX que um item completa (#92 na /pix-mcp, #166 na /conciliacao): o mesmo texto
// nas duas telas, com o que ESTE item cobre do que falta.
import { brl } from './dashboard-painel'
import { emLista } from './texto'
import type { ForcadaQueOPixCompleta } from './conciliacao-status'
import type { AlvoTipo } from './conciliacao-alvo'

const emReais = (vs: number[]) => emLista(vs.map(brl))

/**
 * `caixa`: quanto foi marcado e quanto este PIX cobre; `dialogo`: o que muda ao desfazer. `rotulo`: o alvo ("NF 1234",
 * "venda #31902"); `quemFicaLivre`: "este PIX" na /pix-mcp, "esta linha" na /conciliacao.
 */
export function frasesDaForcada({ linhas, cobre }: ForcadaQueOPixCompleta, rotulo: string, quemFicaLivre = 'este PIX') {
  const varias = linhas.length > 1
  const pagamentos = `${varias ? 'Os pagamentos PIX' : 'O pagamento PIX'} de ${emReais(linhas.map(l => l.valor))} da ${rotulo}`
  const falta = linhas.reduce((a, l) => a + l.valor - l.marcado, 0)
  const cobreTudo = Math.abs(falta - cobre) < 0.005
  return {
    caixa: `${pagamentos} ${varias ? 'foram marcados como recebidos' : 'foi marcado como recebido'} com ${emReais(linhas.map(l => l.marcado))}. `
      + (cobreTudo ? `Este PIX cobre os ${brl(cobre)} que faltam.` : `Este PIX cobre ${brl(cobre)} dos ${brl(falta)} que faltam.`),
    dialogo: `${pagamentos} ${varias ? 'deixam de estar marcados como recebidos' : 'deixa de estar marcado como recebido'}, e ${quemFicaLivre} fica livre para vincular de novo.`,
  }
}

/** O alvo da linha de cartão na frase: "venda #31902", "OS #12", "PA #5" (o chip da /conciliacao). */
export const rotuloDoAlvoNaFrase = (tipo: AlvoTipo | undefined, numero: number) =>
  tipo === 'os' ? `OS #${numero}` : tipo === 'peca' ? `PA #${numero}` : `venda #${numero}`
