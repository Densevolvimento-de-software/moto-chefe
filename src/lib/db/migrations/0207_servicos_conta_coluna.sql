-- A coluna começa opcional para manter o cadastro atual durante a implantação.
alter table servicos_catalogo add column conta_id uuid references contas(id);
