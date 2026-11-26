-- A pausa de Serviços e OS evita gravações pelo código antigo entre as migrações e o deploy.
lock table servicos_catalogo, os_itens in access exclusive mode;

do $$
begin
  if exists (select 1 from servicos_catalogo where conta_id is null and not migracao_273_origem) then
    raise exception 'Serviço global criado após a cópia: migração cancelada';
  end if;
  if exists (select 1 from os_itens i join servicos_catalogo s on s.id = i.servico_id where s.conta_id is null) then
    raise exception 'OS ainda aponta para serviço global: migração cancelada';
  end if;
end $$;

select id from servicos_catalogo where conta_id is null;
delete from servicos_catalogo where conta_id is null;
alter table servicos_catalogo alter column conta_id set not null;
alter table servicos_catalogo drop column migracao_273_origem;
