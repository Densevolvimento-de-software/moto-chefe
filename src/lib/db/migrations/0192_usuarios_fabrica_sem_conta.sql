-- #3: o login da fábrica (papel fabrica, 0190) é da plataforma, não de um cliente: sem loja,
-- Conta, cargo, papéis extras, módulos liberados, grupos de acesso ou de aprovação nem aprovação de
-- pagamento sensível. Módulo bloqueado pode (só tira acesso). A tela
-- de acessos da fábrica já grava assim; aqui o banco recusa qualquer outro caminho.
-- (O getUsuarioLogado também zera loja e Conta desse papel na sessão.)
-- Separada da 0190: o valor novo de um enum não pode ser usado na mesma transação.
alter table usuarios add constraint usuarios_fabrica_sem_conta check (
  papel <> 'fabrica' or (
    loja_id is null and conta_id is null and cargo_id is null
    and cardinality(papeis_extras) = 0 and cardinality(modulos_extras) = 0
    and cardinality(grupos_acesso) = 0 and cardinality(grupos_aprovacao) = 0
    and not aprova_pagamento_sensivel
  )
);
