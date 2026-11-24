-- #220: o dono de uma Conta decide se o aux_adm forca e desfaz conciliacao forcada no grupo dele.
-- Ligada por padrao, para nenhum grupo mudar sozinho. Desligar e SQL fora do repo, antes do deploy.
alter table grupos add column aux_adm_pode_forcar_conciliacao boolean not null default true;
