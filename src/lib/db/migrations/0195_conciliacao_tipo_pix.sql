-- #51: o Pix da maquininha Mercado Pago é conciliado em conciliacoes_cartao, como linha tipo 'pix'
-- (decisão do Luis). O check do baseline (supabase/schema-baseline.sql) só aceitava crédito e débito.
-- Sem "if exists": se o nome mudar, a migração falha em vez de seguir sem trocar o check.
alter table conciliacoes_cartao drop constraint conciliacoes_cartao_tipo_check;
alter table conciliacoes_cartao add constraint conciliacoes_cartao_tipo_check
  check (tipo in ('credito', 'debito', 'pix'));
