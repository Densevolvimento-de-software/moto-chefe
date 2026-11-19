-- #149: quem categoriza as saídas do banco em /despesas passa a ser uma marca por usuário, ligada
-- só pelo admin_geral em /admin/usuarios (antes era uma lista fixa no código). Só a coluna: quem já
-- tinha a permissão recebe a marca por SQL na release, fora do repo, antes do deploy.
alter table usuarios add column categoriza_despesa_banco boolean not null default false;

-- O login da fábrica (0192) também não leva esta marca: a regra da 0192 mais a coluna nova.
alter table usuarios drop constraint usuarios_fabrica_sem_conta;
alter table usuarios add constraint usuarios_fabrica_sem_conta check (
  papel <> 'fabrica' or (
    loja_id is null and conta_id is null and cargo_id is null
    and cardinality(papeis_extras) = 0 and cardinality(modulos_extras) = 0
    and cardinality(grupos_acesso) = 0 and cardinality(grupos_aprovacao) = 0
    and not aprova_pagamento_sensivel
    and not categoriza_despesa_banco
  )
);
