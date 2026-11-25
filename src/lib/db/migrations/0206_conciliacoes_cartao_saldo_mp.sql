-- #51: `account_money` da Point é uma linha própria, separada do Pix e dos cartões.
alter table conciliacoes_cartao drop constraint conciliacoes_cartao_tipo_check;
alter table conciliacoes_cartao add constraint conciliacoes_cartao_tipo_check
  check (tipo in ('credito', 'debito', 'pix', 'saldo_mp'));
