-- O frete do pedido mora só na Entrega (pedidos_venda.entrega->'frete' e vendas.entrega->'frete', #726),
-- que a NF, a efetivação, a aprovação e os relatórios (#796) já leem. O tipo 'frete' do item (0178) seria
-- um segundo lugar para o mesmo valor (decisão do Luis na #779, D1). Nenhum código grava item 'frete';
-- se houver linha assim, o check novo falha ao validar e a migração não passa, em vez de apagar dado.
alter table pedidos_venda_itens drop constraint pedidos_venda_itens_tipo_ck;
alter table pedidos_venda_itens add constraint pedidos_venda_itens_tipo_ck check (tipo in ('moto', 'brinde', 'acessorio'));
