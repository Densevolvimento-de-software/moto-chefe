-- Índices para o custo do PIX no líquido da venda (#93). O líquido de cada venda soma o custo dos PIX ligados à
-- venda ou ao pedido dela e procura a venda de menor número do pedido. Sem índice, cada venda varre as tabelas
-- inteiras: na cópia da produção (1.832 vendas, 2.906 PIX) o líquido de um ano foi de 2,8 ms para 334 ms, e ele
-- entra no /financeiro, no DRE, no dashboard, no fechamento, na coletiva e na exportação contábil.
-- Parciais nos PIX: só as linhas ligadas entram (a maioria dos PIX ainda está sem vínculo).
create index if not exists pix_recebimentos_mcp_venda_id_idx on pix_recebimentos_mcp (venda_id) where venda_id is not null;
create index if not exists pix_recebimentos_mcp_pedido_id_idx on pix_recebimentos_mcp (pedido_id) where pedido_id is not null;
create index if not exists vendas_pedido_venda_id_idx on vendas (pedido_venda_id);
