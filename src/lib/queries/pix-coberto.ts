import { sql } from 'drizzle-orm'

/**
 * Quanto o PIX recebido cobre do pagamento, para a soma das subconsultas de conciliação (#90): o valor
 * do PIX gravado ao vincular; sem ele (vínculo de antes do custo do PIX), o que o banco creditou.
 * A mesma regra do painel está em `valorQueCobre` (src/lib/conciliacao-status.ts).
 * Nome qualificado em texto: as 7 somas são subconsultas escritas à mão em arquivos diferentes, e o
 * nome da tabela deixa explícito de onde vem cada coluna, qualquer que seja o FROM de fora.
 */
export const pixCobertoSql = () =>
  sql.raw('coalesce("pix_recebimentos_mcp"."valor_bruto", "pix_recebimentos_mcp"."valor")::numeric')
