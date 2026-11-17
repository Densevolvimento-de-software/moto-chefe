-- Pedido com várias motos (#20): a efetivação grava uma venda por moto. vendas.numero é único (0004) e o
-- gatilho copiava sempre o número do pedido, então a 2ª venda do mesmo pedido estourava o unique.
-- Decisão do Luis (17/11/2026): a 1ª venda do pedido herda o número dele, como antes; as outras pegam o
-- próximo da sequência. O nextval fica aqui porque vendas.numero não tem default no banco (o do schema.ts
-- não chegou à baseline). Pedido de 1 moto não muda. A efetivação trava o pedido (for update), então
-- duas "1ª venda" do mesmo pedido não correm juntas.
create or replace function fn_set_venda_numero()
returns trigger as $$
begin
  if exists (select 1 from vendas where pedido_venda_id = new.pedido_venda_id) then
    new.numero := nextval('numero_venda_seq');
  else
    select numero into new.numero from pedidos_venda where id = new.pedido_venda_id;
  end if;
  return new;
end;
$$ language plpgsql;
