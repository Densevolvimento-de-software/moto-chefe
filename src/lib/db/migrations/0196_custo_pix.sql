-- #89 (spec #86): Custo do PIX, a tarifa que o banco cobra sobre cada PIX recebido (CONTEXT.md).
-- Fração, como imposto e taxas_cartao (0.002 = 0,20%). 0 = o banco não cobra, e tudo fica como era.
-- Menos de 1: com 100% o crédito seria 0 e não haveria valor do PIX a calcular.
alter table configuracao_taxas add column custo_pix_taxa numeric(8,6) not null default 0;
alter table configuracao_taxas add constraint configuracao_taxas_custo_pix_taxa_check
  check (custo_pix_taxa >= 0 and custo_pix_taxa < 1);

-- O valor do PIX recebido é o que o banco creditou. Na conciliação (#90) grava-se o valor do PIX
-- (bruto), o custo e a taxa da época: mudar a taxa do grupo depois não muda o que já foi conciliado.
-- Nulos enquanto o PIX não está conciliado.
alter table pix_recebimentos_mcp add column valor_bruto numeric(12,2);
alter table pix_recebimentos_mcp add column custo_pix numeric(12,2);
alter table pix_recebimentos_mcp add column custo_pix_taxa numeric(8,6);

-- Só aditiva. precificacao.taxa_pix (por modelo, sempre 0) sai do código na #89, mas a coluna só cai
-- numa migração depois da release: a versão anterior ainda a lê no SELECT do Drizzle (como na 0100).
