-- #283: porcentagem do preço mínimo PIX que a reserva exige de entrada, por loja.
-- O padrão é 30, o que antes era fixo no código; toda loja existente fica em 30.
-- A trava de 0 a 100 é o limite da regra (0 = sem entrada mínima, 100 = o preço PIX inteiro).
-- A constraint tem nome explícito: a convenção do Postgres daria outro nome ao check inline.
alter table lojas
  add column entrada_minima_reserva_pct integer not null default 30,
  add constraint lojas_entrada_minima_reserva_pct_check check (entrada_minima_reserva_pct between 0 and 100);
