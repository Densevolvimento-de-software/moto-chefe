-- Copiar antes de remover os originais permite que a migração seja revisada em etapas.
alter table servicos_catalogo add column migracao_273_origem boolean not null default false;
select id from servicos_catalogo where conta_id is null;
update servicos_catalogo set migracao_273_origem = true where conta_id is null;
create temporary table servicos_migracao_mapa (
  antigo_id uuid not null, conta_id uuid not null, novo_id uuid not null,
  primary key (antigo_id, conta_id)
) on commit drop;

do $$
begin
  if exists (
    select 1 from os_itens i
    left join ordens_servico o on o.id = i.os_id
    left join lojas l on l.id = o.loja_id
    left join grupos g on g.id = l.grupo_id
    where i.servico_id is not null and g.conta_id is null
  ) then
    raise exception 'OS com serviço sem Conta: migração cancelada';
  end if;
  if exists (
    select 1 from os_itens i join servicos_catalogo s on s.id = i.servico_id
    join ordens_servico o on o.id = i.os_id join lojas l on l.id = o.loja_id
    join grupos g on g.id = l.grupo_id
    where s.conta_id is not null and s.conta_id <> g.conta_id
  ) then
    raise exception 'OS ligada a serviço de outra Conta: migração cancelada';
  end if;
end $$;

insert into servicos_migracao_mapa (antigo_id, conta_id, novo_id)
select usados.servico_id, usados.conta_id, gen_random_uuid() from (
  select distinct i.servico_id, g.conta_id
  from os_itens i join servicos_catalogo s on s.id = i.servico_id
  join ordens_servico o on o.id = i.os_id join lojas l on l.id = o.loja_id
  join grupos g on g.id = l.grupo_id
  where s.conta_id is null
) usados;

insert into servicos_catalogo (id, conta_id, nome, tempo_previsto_minutos, valor, ativo, criado_em, atualizado_em)
select m.novo_id, m.conta_id, s.nome, s.tempo_previsto_minutos, s.valor, s.ativo, s.criado_em, s.atualizado_em
from servicos_migracao_mapa m join servicos_catalogo s on s.id = m.antigo_id;

select i.id from os_itens i
join ordens_servico o on o.id = i.os_id join lojas l on l.id = o.loja_id
join grupos g on g.id = l.grupo_id
join servicos_migracao_mapa m on m.antigo_id = i.servico_id and m.conta_id = g.conta_id;

update os_itens i set servico_id = m.novo_id
from ordens_servico o join lojas l on l.id = o.loja_id join grupos g on g.id = l.grupo_id,
  servicos_migracao_mapa m
where i.os_id = o.id and m.antigo_id = i.servico_id and m.conta_id = g.conta_id;

do $$
begin
  if exists (select 1 from os_itens i join servicos_catalogo s on s.id = i.servico_id where s.conta_id is null) then
    raise exception 'OS ainda aponta para serviço global: migração cancelada';
  end if;
end $$;

create index servicos_catalogo_conta_id_idx on servicos_catalogo (conta_id);
