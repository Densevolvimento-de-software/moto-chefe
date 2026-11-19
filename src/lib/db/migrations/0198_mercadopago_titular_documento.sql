-- #51: documento do titular da conta do Mercado Pago (o que o /users/me devolve), para o Editar Grupo avisar
-- quando o CNPJ do titular não é o do grupo (decisão do Luis: aviso guardado, junto do "Configurada", sem recusar).
-- Nulo quando o Mercado Pago não manda o documento. A lista compara com o CNPJ do grupo na hora e manda à tela
-- só o resultado; o documento não vai ao navegador nem ao log.
alter table mercadopago_config add column titular_documento text;
