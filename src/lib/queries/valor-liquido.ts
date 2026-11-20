import { and, eq, sql, type SQL } from 'drizzle-orm'
import { db } from '@/lib/db'
import { taxasDaReceita } from '@/lib/dre'
import { vendas, conciliacoesCartao } from '@/lib/db/schema'
import { LINHA_PIX } from '@/lib/conciliacao-cartao'
import { PAGAMENTO_PIX } from '@/lib/conciliacao-status'
import { OPERACAO_COM_CUSTO } from '@/lib/custo-pix'

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

type ColunasDaVenda = { id: SQL; pedido: SQL; numero: SQL; loja: SQL; pagamentos: SQL }

/** O grupo da loja dada: só conta PIX desse grupo. */
const grupoDaLoja = (loja: SQL) => sql`(SELECT lj.grupo_id FROM lojas lj WHERE lj.id = ${loja})`
/** As colunas da tabela ou do alias `a` na consulta. */
const colunasDe = (a: string) => (c: string) => sql.raw(`${a}.${c}`)

// Os PIX do banco da venda (alias `pr`): os dela e os do pedido na 1ª venda, do grupo da loja.
const pixDoBancoDaVenda = (c: ColunasDaVenda) => sql`pr.grupo_id = ${grupoDaLoja(c.loja)}
  AND (pr.venda_id = ${c.id}
       OR (pr.pedido_id = ${c.pedido}
           AND ${c.numero} = (SELECT MIN(vp.numero) FROM vendas vp WHERE vp.pedido_venda_id = ${c.pedido})))`

/**
 * Custo do PIX da venda (#93), a parte que o banco ficou dos PIX: o dos PIX conciliados da venda, o dos PIX
 * conciliados do pedido dela (o do pedido inteiro na 1ª venda, a de menor número; decisão do Luis registrada na
 * #93) e o das forçadas de PIX (gravado na marca). Só conta PIX do grupo da loja da venda. PIX não conciliado,
 * TED e grupo com taxa 0 têm custo 0. As duas formas montam a mesma conta a partir das colunas da venda.
 */
function custoPixDaVenda(c: ColunasDaVenda) {
  return sql`(
    COALESCE((SELECT SUM(pr.custo_pix::numeric) FROM pix_recebimentos_mcp pr WHERE ${pixDoBancoDaVenda(c)}), 0)
    + ${custoDasForcadasPix(c.pagamentos, { pedido: c.pedido, loja: c.loja })}
  )`
}

// O card conta PIX (#94): TED e outras transferências vinculadas não têm custo e ficam fora; sem tipo, conta como PIX.
const soPix = sql`(pr.tipo_operacao IS NULL OR pr.tipo_operacao = ${OPERACAO_COM_CUSTO})`

/** Quantos pagamentos PIX forçados (com a marca do PIX, #92) há na coluna `pagamentos`. */
const qtdForcadasPix = (pagamentos: SQL) => sql`(SELECT COUNT(*) FROM jsonb_array_elements(COALESCE(${pagamentos}, '[]'::jsonb)) pg
  WHERE pg->'conciliadoManual'->'pix' IS NOT NULL)`

/**
 * Quantos PIX entram no custo do PIX da venda (#94, decisão do Luis na #94): os PIX do banco da conta acima (o do pedido
 * uma vez, na 1ª venda) e os pagamentos PIX forçados. A linha pix da maquininha não entra: é tarifa.
 */
export const qtdPixDaVendaExpr = () => {
  const c = colunasDaVenda()
  return sql`((SELECT COUNT(*) FROM pix_recebimentos_mcp pr WHERE ${pixDoBancoDaVenda(c)} AND ${soPix}) + ${qtdForcadasPix(c.pagamentos)})`
}

/**
 * Custo do PIX de uma OS ou venda de peça (#94) e quantos PIX entram nele: os PIX do banco ligados ao registro, do grupo
 * da loja dele, e as forçadas de PIX (sem pedido: o custo gravado conta inteiro). `a`: a tabela ou o alias na consulta.
 */
function pixDoRegistro(coluna: 'os_id' | 'peca_venda_id', a: string) {
  const col = colunasDe(a)
  const doBanco = sql`pr.${sql.raw(coluna)} = ${col('id')} AND pr.grupo_id = ${grupoDaLoja(col('loja_id'))}`
  return {
    custo: sql`(COALESCE((SELECT SUM(pr.custo_pix::numeric) FROM pix_recebimentos_mcp pr WHERE ${doBanco}), 0) + ${custoDasForcadasPix(col('pagamentos'))})`,
    qtd: sql`((SELECT COUNT(*) FROM pix_recebimentos_mcp pr WHERE ${doBanco} AND ${soPix}) + ${qtdForcadasPix(col('pagamentos'))})`,
  }
}
export const pixDaOs = (a = '"ordens_servico"') => pixDoRegistro('os_id', a)
export const pixDaPeca = (a = '"vendas_pecas"') => pixDoRegistro('peca_venda_id', a)

/**
 * Custo das forçadas de PIX que conta no líquido: o gravado nas marcas (conciliadoManual.pix.custoPix, #92) menos a
 * parte que os PIX com custo ligados ao pedido da venda cobrem. É a conta de `custoDaForcadaQueConta`
 * (`src/lib/custo-pix.ts`, decisão 10 do Luis na #93), forçada a forçada, ao centavo.
 * `pagamentos` é a coluna jsonb do registro; OS e venda de peça (#94) não têm pedido e contam o custo inteiro.
 */
export function custoDasForcadasPix(pagamentos: SQL, pedidoDaVenda?: { pedido: SQL; loja: SQL }) {
  const custo = sql`ROUND((pg->'conciliadoManual'->'pix'->>'custoPix')::numeric * 100)`
  if (!pedidoDaVenda) return sql`COALESCE((SELECT SUM(${custo}) / 100 FROM jsonb_array_elements(COALESCE(${pagamentos}, '[]'::jsonb)) pg), 0)`
  const grupo = grupoDaLoja(pedidoDaVenda.loja)
  // Em centavos inteiros, meio centavo para cima, como custoDaForcadaQueConta: tela e líquido dão o mesmo no empate.
  return sql`COALESCE((SELECT SUM(CASE WHEN cob.p <= 0 OR cob.f <= 0 THEN ${custo} WHEN cob.p >= cob.f THEN 0
                                  ELSE FLOOR((2 * ${custo} * (cob.f - cob.p) + cob.f) / (2 * cob.f)) END) / 100
              FROM jsonb_array_elements(COALESCE(${pagamentos}, '[]'::jsonb)) pg
              CROSS JOIN (SELECT ROUND(${pixComCustoDoPedido(pedidoDaVenda.pedido, grupo)} * 100) AS p,
                                 ROUND(${pixDasVendasDoPedido(pedidoDaVenda.pedido, grupo)} * 100) AS f) cob), 0)`
}

/** Valor bruto dos PIX com custo ligados ao pedido, do grupo dado: o P da cobertura (decisão 10 do Luis, #93). */
export const pixComCustoDoPedido = (pedido: SQL, grupo: SQL) => sql`(SELECT COALESCE(SUM(pr.valor_bruto::numeric), 0)
  FROM pix_recebimentos_mcp pr WHERE pr.pedido_id = ${pedido} AND pr.custo_pix > 0 AND pr.grupo_id = ${grupo})`

/**
 * Pagamentos PIX das vendas do pedido, forçados ou não (decisão 13 do Luis, #93), nas lojas do grupo: o F da
 * cobertura. Os tipos vêm de PAGAMENTO_PIX, a lista da tela. `exceto`: venda que fica de fora.
 */
export const pixDasVendasDoPedido = (pedido: SQL, grupo: SQL, exceto?: SQL) => sql`(SELECT COALESCE(SUM((pf->>'valor')::numeric), 0)
  FROM vendas vf CROSS JOIN LATERAL jsonb_array_elements(COALESCE(vf.pagamentos, '[]'::jsonb)) pf
  WHERE vf.pedido_venda_id = ${pedido} AND vf.loja_id IN (SELECT id FROM lojas WHERE grupo_id = ${grupo})
    AND pf->>'tipo' = ANY(${sql.param([...PAGAMENTO_PIX])}::text[])${exceto ? sql` AND vf.id <> ${exceto}` : sql``})`

// Qualificado à mão: numa query sem join, ${vendas.id} sai sem a tabela e casaria com o id da tabela de dentro.
const colunasDaVenda = (): ColunasDaVenda => ({
  id: sql.raw('"vendas"."id"'), pedido: sql.raw('"vendas"."pedido_venda_id"'), numero: sql.raw('"vendas"."numero"'),
  loja: sql.raw('"vendas"."loja_id"'), pagamentos: sql.raw('"vendas"."pagamentos"'),
})
export const custoPixDaVendaExpr = () => custoPixDaVenda(colunasDaVenda())

/** A mesma conta para o SQL cru com alias (`v` = alias de vendas na query externa). */
function custoPixDaVendaSql(v = 'v') {
  const col = colunasDe(v)
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
    taxaCartaoOutras: 0, tarifaPixOutras: 0, custoPixOutras: 0,
  })
  return { taxaCartao: taxasCartao, tarifaPix, custoPix, liquido }
}

