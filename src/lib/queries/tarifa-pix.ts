// Tarifa do Pix da maquininha Mercado Pago (#51): linha própria no DRE, no Financeiro e no Fechamento,
// fora da "taxa de cartão" (decisão do Luis). Cada parte usa a mesma data e a mesma conta da taxa de
// onde ela sai, para a soma "taxas de cartão + tarifa do Pix" ficar igual à taxa de antes:
//   moto: data da venda; bruto − líquido como em valorLiquidoExpr (linha sem líquido conta inteira);
//   OS concluída (data de conclusão) e peça (data da venda): bruto − líquido, sem líquido conta zero.
import { sql } from 'drizzle-orm'
import { execRows } from '@/lib/db'
import { conciliacoesCartao, ordensServico, vendas, vendasPecas } from '@/lib/db/schema'
import { LINHA_PIX } from '@/lib/conciliacao-cartao'

/** `mes` no formato das consultas do DRE: 'YYYY-M' (mês sem zero à esquerda, em UTC). */
export type TarifaPix = { lojaId: string; mes: string; tarifa: number }

/** Período [inicio, fim). O filtro de loja fica no SQL: sem ele a consulta leria a tarifa de todas as Contas. */
export async function tarifaPixDoPeriodo(lojaIds: string[], inicio: Date, fim: Date): Promise<TarifaPix[]> {
  if (lojaIds.length === 0) return []
  const lojas = sql`ANY(${sql.param(lojaIds)}::uuid[])`
  const de = inicio.toISOString()
  const ate = fim.toISOString()
  const linhas = await execRows(sql`
    SELECT loja_id, to_char(data AT TIME ZONE 'UTC', 'YYYY-FMMM') AS mes, COALESCE(SUM(tarifa), 0)::text AS tarifa
      FROM (
        SELECT v.loja_id, v.data_venda AS data,
               c.valor_bruto::numeric - COALESCE(c.valor_liquido::numeric, 0) AS tarifa
          FROM ${conciliacoesCartao} c
          JOIN ${vendas} v ON v.id = c.venda_id
         WHERE c.conciliado = true AND c.tipo = ${LINHA_PIX}
           AND v.loja_id = ${lojas} AND v.data_venda >= ${de} AND v.data_venda < ${ate}
        UNION ALL
        SELECT o.loja_id, o.data_conclusao AS data,
               c.valor_bruto::numeric - COALESCE(c.valor_liquido::numeric, c.valor_bruto::numeric) AS tarifa
          FROM ${conciliacoesCartao} c
          JOIN ${ordensServico} o ON o.id = c.os_id
         WHERE c.conciliado = true AND c.tipo = ${LINHA_PIX} AND o.status = 'concluida'
           AND o.loja_id = ${lojas} AND o.data_conclusao >= ${de} AND o.data_conclusao < ${ate}
        UNION ALL
        SELECT p.loja_id, p.data_venda AS data,
               c.valor_bruto::numeric - COALESCE(c.valor_liquido::numeric, c.valor_bruto::numeric) AS tarifa
          FROM ${conciliacoesCartao} c
          JOIN ${vendasPecas} p ON p.id = c.peca_venda_id
         WHERE c.conciliado = true AND c.tipo = ${LINHA_PIX}
           AND p.loja_id = ${lojas} AND p.data_venda >= ${de} AND p.data_venda < ${ate}
      ) t
     GROUP BY 1, 2
  `) as { loja_id: string; mes: string; tarifa: string }[]
  return linhas.map(l => ({ lojaId: l.loja_id, mes: l.mes, tarifa: Number(l.tarifa) }))
}

/** Soma a tarifa pela chave escolhida (loja ou mês). */
export function somaTarifaPor(linhas: TarifaPix[], chave: (l: TarifaPix) => string): Map<string, number> {
  return linhas.reduce((m, l) => new Map(m).set(chave(l), (m.get(chave(l)) ?? 0) + l.tarifa), new Map<string, number>())
}

export const tarifaTotal = (linhas: TarifaPix[]): number => linhas.reduce((s, l) => s + l.tarifa, 0)
