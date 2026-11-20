-- Índices para o custo do PIX de OS e venda de peça (#94). O Financeiro e o DRE somam, para cada OS e cada venda de
-- peça do período, o custo e a quantidade dos PIX ligados a ela. Sem índice, cada OS e cada peça varre a tabela de
-- PIX inteira: medido na cópia da produção, a soma de 12 meses das OS do maior grupo fez uma varredura completa por
-- OS, e o tempo cresce com OS vezes PIX. Parciais, como os da 0200: só as linhas ligadas a OS ou peça entram.
create index if not exists pix_recebimentos_mcp_os_id_idx on pix_recebimentos_mcp (os_id) where os_id is not null;
create index if not exists pix_recebimentos_mcp_peca_venda_id_idx on pix_recebimentos_mcp (peca_venda_id) where peca_venda_id is not null;
