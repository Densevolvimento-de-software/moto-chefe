-- Papel fabrica (#901): login da fábrica MotoChefe, que só lê o painel em /fabrica.
-- Sem Conta e sem loja; ninguém recebe o papel aqui (quem cria o login é o ticket D).
-- Sozinho no arquivo: o valor novo de um enum não pode ser usado na mesma transação.
alter type papel add value if not exists 'fabrica';
