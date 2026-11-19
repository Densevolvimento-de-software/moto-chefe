import { sql } from 'drizzle-orm'

/**
 * Quanto o PIX recebido cobre do pagamento, para a soma das subconsultas de conciliação (#90): o valor
 * do PIX gravado ao vincular; sem ele (vínculo de antes do custo do PIX), o que o banco creditou.
 * Nome qualificado em texto: sem join, `${pixRecebimentosMcp.valor}` sai só "valor" e casaria com a
 * coluna da tabela de fora (vendas e ordens_servico também têm `valor`).
 */
export const pixCobertoSql = () =>
  sql.raw('coalesce("pix_recebimentos_mcp"."valor_bruto", "pix_recebimentos_mcp"."valor")::numeric')
