-- #236: ids de contas do mcp.ai de outro CNPJ do mesmo dono que entram na tela PIX do grupo. Só valem em grupo
-- com chave própria do mcp.ai (o servidor recusa gravar sem ela). Vazio = comportamento de sempre.
alter table grupos add column mcpai_contas_pix_ids text[] not null default '{}';
