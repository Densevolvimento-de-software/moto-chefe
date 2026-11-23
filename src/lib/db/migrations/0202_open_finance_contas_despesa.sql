-- #209: contas do mcp.ai cujas saídas viram despesa, por grupo. Eram uma lista fixa por CNPJ no
-- código; grupo fora dela perdia todas as saídas em silêncio. Só a tabela: os dados reais entram
-- por SQL fora do repo, antes do deploy (sem a carga, os grupos que hoje dependem da lista fixa ficam sem saídas).
create table open_finance_contas_despesa (
  id        uuid primary key default gen_random_uuid(),
  grupo_id  uuid not null references grupos(id),
  banco     text not null,
  inicio_em timestamptz,
  criado_em timestamptz not null default now(),
  constraint open_finance_contas_despesa_grupo_banco_key unique (grupo_id, banco)
);

-- RLS sem policy fecha a tabela para o PostgREST; o app lê e grava pelo Drizzle.
alter table open_finance_contas_despesa enable row level security;
