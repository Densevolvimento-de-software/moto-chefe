-- #51: conciliação da maquininha Mercado Pago (Point).
--
-- mercadopago_config: credencial do Mercado Pago de cada grupo (ADR 0010), uma linha por grupo.
-- Tabela própria, como a notagateway_config, e não colunas em grupos: as listas de grupos chegam
-- inteiras a telas, e a credencial não pode ir junto (decisão do Luis na #51). token é cifrado
-- (src/lib/cripto.ts, iv:tag:dados). user_id é a conta no Mercado Pago.

create table mercadopago_config (
  grupo_id       uuid primary key references grupos(id) on delete cascade,
  token          text not null,
  user_id        text not null unique, -- uma conta do Mercado Pago em um grupo só
  public_key     text,
  atualizado_por uuid references usuarios(id) on delete set null,
  atualizado_em  timestamptz not null default now()
);

-- RLS sem policy fecha a tabela para o PostgREST; o app lê e grava pelo Drizzle (como a 0186).
alter table mercadopago_config enable row level security;
