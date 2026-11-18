// Taxas das receitas de OS e peça (#51): a parte de cartão e a tarifa do Pix da maquininha Mercado Pago
// saem do mesmo SELECT, da mesma linha, para a soma das duas ser sempre a taxa de antes.
import { sql } from 'drizzle-orm'
import { execRows } from '@/lib/db'
import { conciliacoesCartao, ordensServico, vendasPecas } from '@/lib/db/schema'
import { LINHA_PIX } from '@/lib/conciliacao-cartao'

/**
 * Taxa de uma linha conciliada de OS ou peça, com a tabela de conciliação sob o alias `c`: bruto − líquido;
 * linha sem líquido conta zero. (A da moto segue a regra do valor líquido da venda, em valor-liquido.ts.)
 */
export const taxaDaLinhaOutras = sql.raw('c.valor_bruto::numeric - COALESCE(c.valor_liquido::numeric, c.valor_bruto::numeric)')

/**
 * Recorte do Financeiro: OS concluídas e peças de [inicio, fimInclusivo], nas lojas pedidas (lista vazia, como
 * no recorte Geral, não soma nada). O filtro de loja fica no SQL: sem ele a soma leria as outras Contas.
 */
export async function taxasOutrasDoPeriodo(
  lojaIds: string[], inicio: Date, fimInclusivo: Date,
): Promise<{ taxaCartao: number; tarifaPix: number }> {
  if (lojaIds.length === 0) return { taxaCartao: 0, tarifaPix: 0 }
  const lojas = sql`ANY(${sql.param(lojaIds)}::uuid[])`
  const de = inicio.toISOString()
  const ate = fimInclusivo.toISOString()
  const [r] = await execRows(sql`
    SELECT COALESCE(SUM(${taxaDaLinhaOutras}) FILTER (WHERE c.tipo <> ${LINHA_PIX}), 0)::text AS taxa,
           COALESCE(SUM(${taxaDaLinhaOutras}) FILTER (WHERE c.tipo = ${LINHA_PIX}), 0)::text AS tarifa_pix
      FROM ${conciliacoesCartao} c
     WHERE c.conciliado = true
       AND (
         c.os_id IN (
           SELECT o.id FROM ${ordensServico} o
            WHERE o.status = 'concluida' AND o.loja_id = ${lojas}
              AND o.data_conclusao >= ${de} AND o.data_conclusao <= ${ate}
         )
         OR c.peca_venda_id IN (
           SELECT p.id FROM ${vendasPecas} p
            WHERE p.loja_id = ${lojas} AND p.data_venda >= ${de} AND p.data_venda <= ${ate}
         )
       )
  `) as { taxa: string; tarifa_pix: string }[]
  return { taxaCartao: Number(r?.taxa ?? 0), tarifaPix: Number(r?.tarifa_pix ?? 0) }
}
