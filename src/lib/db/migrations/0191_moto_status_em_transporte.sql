-- Status "Em transporte" da moto (#9): já comprada pela nota de entrada, ainda não chegou na loja.
-- Sozinho no arquivo: o valor novo de um enum não pode ser usado na mesma transação.
alter type moto_status add value if not exists 'em_transporte';
