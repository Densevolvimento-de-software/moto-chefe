-- #51: a última importação do Mercado Pago de cada grupo, para a faixa da /conciliacao (decisão do Luis).
-- Na linha da credencial: a faixa só existe com credencial, e remover a credencial leva junto o que não
-- serve mais. Uma linha por grupo, como pix_mcp_sync_status; não é a fila importacoes_cartao (do agente local).
--
-- ultima_importacao_em, ultimo_resumo: a última rodada que importou (rotina diária ou botão), com as contagens
-- e o detalhe dos não tratados do próprio grupo (motivo, valor, data), que só a tela de quem gere lê.
-- ultima_falha: { em, erro } da última rodada que falhou depois da última que importou; nula se ela deu certo.
-- erro é só a frase conhecida (nunca token nem corpo cru da resposta do Mercado Pago).
alter table mercadopago_config add column ultima_importacao_em timestamptz;
alter table mercadopago_config add column ultimo_resumo jsonb;
alter table mercadopago_config add column ultima_falha jsonb;
