# Sumário dos resumos fiscais

Um arquivo por assunto da Nota Gateway, escrito à mão: o que a doc oficial diz, o que ela não diz (com fonte) e onde isso vive no MOVA. Assunto sem arquivo: a skill `nota-gateway-docs` cria o resumo no mesmo padrão e acrescenta a linha aqui, no mesmo PR.

| Arquivo | Assunto | Quando ler |
|---|---|---|
| [ng-inutilizar-numeracao.md](ng-inutilizar-numeracao.md) | Inutilizar numeração de NF-e na Nota Gateway | Antes de mexer no pedido, na consulta ou na tela de inutilização, ou ao decidir se um número pode ser inutilizado |
| [ng-webhook.md](ng-webhook.md) | Webhook: o aviso da Nota Gateway, inclusive o de inutilização | Antes de mexer na rota `/api/webhooks/notagateway`, no token ou no tratamento de um aviso |
| [ng-certificado-digital.md](ng-certificado-digital.md) | Certificado A1 matriz/filial e distribuição DF-e | Antes de alterar vínculo de certificado, CNPJ interessado ou leitura no Radar fiscal |
| [ng-veiculo-transporte.md](ng-veiculo-transporte.md) | Veículo novo, faturamento direto e transporte na Nota Gateway | Antes de alterar tpOp, modalidade de frete ou local de entrega em NF-e de veículo novo |
| [ng-informacoes-adicionais.md](ng-informacoes-adicionais.md) | Observação (informações adicionais) da NF-e: limite e texto que a NG acrescenta | Antes de mudar o texto padrão da garantia, a edição da observação ou o limite |
| [ng-autenticacao.md](ng-autenticacao.md) | Autenticação: o token da API no header `Authorization: Basic` | Antes de mexer em como o token da NG é colado, gravado, enviado ou logado |
