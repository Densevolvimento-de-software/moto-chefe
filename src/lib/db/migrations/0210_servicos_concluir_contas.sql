-- A pausa de Serviços e OS evita gravações pelo código antigo entre as migrações e o deploy.
-- Sem lock_timeout, o lock exclusivo esperaria atrás de qualquer transação aberta em os_itens e
-- enfileiraria as leituras de OS. Estourou: a migração aborta inteira e nada é apagado.
set local lock_timeout = '5s';
lock table servicos_catalogo, os_itens in access exclusive mode;

do $$
begin
  if exists (select 1 from servicos_catalogo where conta_id is null and not migracao_273_origem) then
    raise exception 'Serviço global criado após a cópia: migração cancelada';
  end if;
  if exists (select 1 from os_itens i join servicos_catalogo s on s.id = i.servico_id where s.conta_id is null) then
    raise exception 'OS ainda aponta para serviço global: migração cancelada';
  end if;
  -- O código antigo ainda no ar entre a 0209 e o deploy pode ter ligado um item à cópia de outra Conta.
  if exists (
    select 1 from os_itens i join servicos_catalogo s on s.id = i.servico_id
    join ordens_servico o on o.id = i.os_id join lojas l on l.id = o.loja_id
    join grupos g on g.id = l.grupo_id
    where s.conta_id <> g.conta_id
  ) then
    raise exception 'OS ligada a serviço de outra Conta: migração cancelada';
  end if;
end $$;

delete from servicos_catalogo where conta_id is null;
alter table servicos_catalogo alter column conta_id set not null;
alter table servicos_catalogo drop column migracao_273_origem;
