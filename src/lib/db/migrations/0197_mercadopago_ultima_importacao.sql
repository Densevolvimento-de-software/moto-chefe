-- #51: a última importação do Mercado Pago de cada grupo, para a faixa da /conciliacao (decisão do Luis).
-- Na linha da credencial: a faixa só existe com credencial, e remover a credencial leva junto o que não
-- serve mais. Uma linha por grupo, como pix_mcp_sync_status; não é a fila importacoes_cartao (do agente local).
--
-- ultima_importacao_em, ultimo_resumo: a última rodada (rotina diária ou botão) que terminou sem erro, mesmo
-- sem pagamento novo, com as contagens e o detalhe dos não tratados do próprio grupo (motivo, valor, data),
-- que só a tela de quem gere a conciliação lê.
-- ultima_falha_em, ultima_falha_erro: a última rodada que falhou; nulas quando a rodada mais recente deu certo
-- (a rodada boa limpa a falha). O erro deve ser só a frase conhecida, nunca token nem corpo cru da resposta do
-- Mercado Pago (quem grava garante). Hora e erro em colunas próprias, como fabrica_sync_loja e
-- importacoes_cartao, para comparar no SQL a falha com a última importação.
alter table mercadopago_config add column ultima_importacao_em timestamptz;
alter table mercadopago_config add column ultimo_resumo jsonb;
alter table mercadopago_config add column ultima_falha_em timestamptz;
alter table mercadopago_config add column ultima_falha_erro text;
alter table mercadopago_config add constraint mercadopago_config_ultima_falha_par
  check ((ultima_falha_em is null) = (ultima_falha_erro is null));
