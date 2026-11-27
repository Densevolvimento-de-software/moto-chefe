-- #321 e #322 (API MotoChefe): tipos do log de ações para marcar loja, autorizar Conta e gerar, trocar ou revogar chave.
-- A lista inteira é repetida: recriar o check sem um tipo proíbe gravar esse tipo. Inclui 'entrega_alterada' (0184),
-- que o check já aceitava e que TIPOS_LOG não tinha; sem ele a lista do banco e a do código não batem.
alter table log_acoes drop constraint log_acoes_tipo_check;
alter table log_acoes add constraint log_acoes_tipo_check check (tipo in (
  'login', 'troca_grupo', 'acesso_dia',
  'venda_cancelada', 'nf_emitida', 'nf_cancelada', 'permissao_alterada',
  'certificado_aplicado', 'portal_aplicado', 'notas_enviadas_contador',
  'logo_danfe_enviada', 'preco_compra_alterado', 'grupo_movido_de_conta',
  'transferencia_grupos_alterada', 'moto_arquivada', 'moto_desarquivada',
  'moto_removida', 'entrega_alterada', 'vendedor_venda_trocado',
  'loja_motochefe_alterada', 'autorizacao_conta_alterada',
  'api_chave_gerada', 'api_chave_trocada', 'api_chave_revogada'
));
