import { and, eq, sql, type SQL } from 'drizzle-orm'
import { db } from '@/lib/db'
import { taxasDaReceita } from '@/lib/dre'
import { vendas, conciliacoesCartao } from '@/lib/db/schema'
import { LINHA_PIX } from '@/lib/conciliacao-cartao'

/**
 * Valor da venda com o que já foi conciliado trocado pelo que entrou de fato: a parte paga em cartão vira o
 * líquido da operadora e sai o custo do PIX (#93). O resto fica como está.
 *
 * Detalhe do cartão: a paga em cartão E já conciliada vira o líquido. Cobre venda com forma "multiplos" (cartão + pix/dinheiro), em
 * que descartar a parte não-cartão zeraria dinheiro que entrou de verdade.
 *
 * Enquanto a conciliação não chega, a venda entra pelo bruto — o líquido do mês
 * corrente é sempre otimista e encolhe conforme as transações casam.
 *
 * Vivia copiada em queries/dashboard.ts e no /financeiro; o DRE seria a terceira
 * cópia da mesma expressão, e três cópias de uma regra de dinheiro é uma a mais
 * do que dá para manter em sincronia.
 */
export function valorLiquidoExpr() {
  return sql`(${valorLiquidoDaComissaoExpr()} - ${custoPixDaVendaExpr()})`
}

/**
 * O líquido sem o custo do PIX: a base da comissão e da premiação OTE (a folha e o painel do vendedor). Decisão do
 * Luis registrada na #93: a comissão não desconta o custo do PIX por ora; a decisão final é com o Cesar (#191).
 */
export function valorLiquidoDaComissaoExpr() {
  return sql`(
    ${vendas.valor}::numeric
    - COALESCE((SELECT SUM(${conciliacoesCartao.valorBruto}::numeric)
                FROM ${conciliacoesCartao}
                WHERE ${conciliacoesCartao.vendaId} = ${vendas.id}
                  AND ${conciliacoesCartao.conciliado} = true), 0)
    + COALESCE((SELECT SUM(${conciliacoesCartao.valorLiquido}::numeric)
                FROM ${conciliacoesCartao}
                WHERE ${conciliacoesCartao.vendaId} = ${vendas.id}
                  AND ${conciliacoesCartao.conciliado} = true), 0)
  )`
}

/**
 * A MESMA regra da valorLiquidoExpr(), para as queries em SQL cru (execRows(sql``))
 * onde a tabela vendas entra sob um alias — os relatórios de fechamento, coletiva
 * e individual. `v` é o alias de vendas na query externa (ex.: `from vendas v`).
 *
 * As duas formas moram juntas de propósito: são a mesma regra de dinheiro e
 * precisam mudar em conjunto se a conciliação mudar.
 */
export function valorLiquidoSql(v = 'v') {
  const a = sql.raw(v)
  return sql`(
    ${a}.valor::numeric
    - ${custoPixDaVendaSql(v)}
    - COALESCE((SELECT SUM(cc.valor_bruto::numeric) FROM conciliacoes_cartao cc
                WHERE cc.venda_id = ${a}.id AND cc.conciliado = true), 0)
    + COALESCE((SELECT SUM(cc.valor_liquido::numeric) FROM conciliacoes_cartao cc
                WHERE cc.venda_id = ${a}.id AND cc.conciliado = true), 0)
  )`
}

/**
 * A parte do bruto − líquido da venda que é tarifa do Pix da maquininha Mercado Pago (#51): a mesma regra
 * da valorLiquidoExpr() (linha conciliada sem líquido conta inteira), só nas linhas tipo pix. Mora aqui
 * porque é pedaço da mesma conta e precisa mudar junto com ela.
 */
export function tarifaPixDaVendaExpr() {
  return sql`COALESCE((SELECT SUM(${conciliacoesCartao.valorBruto}::numeric - COALESCE(${conciliacoesCartao.valorLiquido}::numeric, 0))
              FROM ${conciliacoesCartao}
              WHERE ${conciliacoesCartao.vendaId} = ${vendas.id}
                AND ${conciliacoesCartao.conciliado} = true
                AND ${conciliacoesCartao.tipo} = ${LINHA_PIX}), 0)`
}

/**
 * Custo do PIX da venda (#93), a parte que o banco ficou dos PIX: o dos PIX conciliados da venda, o dos PIX
 * conciliados do pedido dela (o do pedido inteiro na 1ª venda, a de menor número; decisão do Luis registrada na
 * #93) e o das forçadas de PIX (gravado na marca). Só conta PIX do grupo da loja da venda. PIX não conciliado,
 * TED e grupo com taxa 0 têm custo 0. As duas formas montam a mesma conta a partir das colunas da venda.
 */
function custoPixDaVenda(c: { id: SQL; pedido: SQL; numero: SQL; loja: SQL; pagamentos: SQL }) {
  return sql`(
    COALESCE((SELECT SUM(pr.custo_pix::numeric) FROM pix_recebimentos_mcp pr
              WHERE pr.grupo_id = (SELECT lj.grupo_id FROM lojas lj WHERE lj.id = ${c.loja})
                AND (pr.venda_id = ${c.id}
                     OR (pr.pedido_id = ${c.pedido}
                         AND ${c.numero} = (SELECT MIN(vp.numero) FROM vendas vp WHERE vp.pedido_venda_id = ${c.pedido})))), 0)
    + ${custoDasForcadasPix(c.pagamentos)}
  )`
}

/**
 * Custo das forçadas de PIX gravado nas marcas dos pagamentos (#92): soma de conciliadoManual.pix.custoPix.
 * `pagamentos` é a coluna jsonb do registro (venda, OS ou venda de peça). Exportada para a #94 (OS e peças).
 */
export function custoDasForcadasPix(pagamentos: SQL) {
  return sql`COALESCE((SELECT SUM((pg->'conciliadoManual'->'pix'->>'custoPix')::numeric)
              FROM jsonb_array_elements(COALESCE(${pagamentos}, '[]'::jsonb)) pg), 0)`
}

// Qualificado à mão: numa query sem join, ${vendas.id} sai sem a tabela e casaria com o id da tabela de dentro.
export const custoPixDaVendaExpr = () => custoPixDaVenda({
  id: sql.raw('"vendas"."id"'), pedido: sql.raw('"vendas"."pedido_venda_id"'), numero: sql.raw('"vendas"."numero"'),
  loja: sql.raw('"vendas"."loja_id"'), pagamentos: sql.raw('"vendas"."pagamentos"'),
})

/** A mesma conta para o SQL cru com alias (`v` = alias de vendas na query externa). */
function custoPixDaVendaSql(v = 'v') {
  const col = (c: string) => sql.raw(`${v}.${c}`)
  return custoPixDaVenda({ id: col('id'), pedido: col('pedido_venda_id'), numero: col('numero'), loja: col('loja_id'), pagamentos: col('pagamentos') })
}

/**
 * Os custos de recebimento de uma venda para os Detalhes da venda (#93), pelas mesmas expressões do líquido e a
 * mesma divisão do DRE (taxasDaReceita): a soma das três é o bruto − líquido. `daConta`: o filtro de vendas da Conta
 * de quem pede (vendasDoEscopo; undefined só para o admin_geral), no where junto do id.
 */
export async function custosDaVenda(vendaId: string, daConta: SQL | undefined) {
  const [r] = await db.select({
      bruto: vendas.valor,
      liquido: sql<string>`${valorLiquidoExpr()}`,
      tarifaPix: sql<string>`${tarifaPixDaVendaExpr()}`,
      custoPix: sql<string>`${custoPixDaVendaExpr()}`,
    }).from(vendas).where(and(eq(vendas.id, vendaId), daConta)).limit(1)
  if (!r) return null
  const liquido = Number(r.liquido)
  const { taxasCartao, tarifaPix, custoPix } = taxasDaReceita({
    brutoMotos: Number(r.bruto), liquidoMotos: liquido, tarifaPixMotos: Number(r.tarifaPix), custoPixMotos: Number(r.custoPix),
    taxaCartaoOutras: 0, tarifaPixOutras: 0,
  })
  return { taxaCartao: taxasCartao, tarifaPix, custoPix, liquido }
}

