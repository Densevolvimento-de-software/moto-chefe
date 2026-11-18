# Nota Gateway: webhook (aviso da Nota Gateway)

Resumo escrito à mão para decidir mudanças no aviso. Cite sempre a página oficial, não este arquivo.

- Página oficial: https://docs.notagateway.com.br/v2/docs/webhook
- `updatedAt` da página na consulta: `2026-07-13T15:58:03.000Z` (consultado em 17/11/2026). Para saber se este resumo está velho: `curl -s https://docs.notagateway.com.br/v2/docs/webhook.md | head -3`.

## O que a página diz

- **Quando avisa**: "Seu sistema será notificado sempre que uma nota fiscal mudar para um dos status abaixo": `Autorizada`, `Negada`, `Cancelada` e `CancelamentoNegado`, no campo `nfeStatus`.
- **Como**: `POST` na URL cadastrada no painel (menu Webhooks, Novo webhook), em JSON ou XML.
- **Token**: opcional no cadastro; "O token de autenticação do webhook fica no cabeçalho da requisição, mais especificamente, no item \"x-token\"".
- **Reenvio**: "o Gateway tentará lhe enviar o webhook de notificação até receber o status \"HTTP 200\""; "Serão realizadas 15 tentativas com intervalos de tempo progressivos entre cada uma delas, totalizando, em média, 4 horas."
- **Corpo da NF-e** (exemplo da página): `tipo` (`"NF-e"`), `empresaId`, `nfeId`, `nfeStatus`, `nfeMotivoStatus` (só não nulo em `Negada` e `CancelamentoNegado`), `nfeNumero`, `nfeSerie`, `nfeChaveAcesso`, `nfeNumeroProtocolo` e links. O da NFC-e é igual, com `tipo: "NFC-e"`.

A página não diz: o tempo máximo que a NG espera a resposta, nem se avisa carta de correção ou inutilização. O aviso de NF-e não traz o ambiente.

## O que a doc NÃO diz

Cada item tem fonte escrita.

- **A inutilização também é avisada**, no mesmo link, com status `Autorizada` ou `Negada`, e cada pedido (número ou faixa) gera um aviso. Fonte: suporte da NG, [comentário na #58](https://github.com/Densevolvimento-de-software/moto-chefe/issues/58).
- **O aviso de inutilização tem o formato da consulta** `GET /v2/empresas/{empresaId}/nf-e/inutilizacao/{id}`: `id` (o id externo que o MOVA mandou), `ambienteEmissao`, `status`, `motivoStatus`, `serie`, `numeroInicial`, `numeroFinal`, `justificativa`, `protocoloAutorizacao`, datas. **Sem `tipo` e sem `empresaId`.** Fonte: a mesma resposta do suporte na #58.
- **Cadastro por conta**: um link recebe o retorno de todas as notas da conta; vários cadastros recebem a mesma notificação. Fonte: a mesma resposta do suporte na #58. O MOVA usa uma conta da NG só, para todos os grupos ([comentário na #58](https://github.com/Densevolvimento-de-software/moto-chefe/issues/58)).

## Como o MOVA usa

Decisões na [#58](https://github.com/Densevolvimento-de-software/moto-chefe/issues/58) ("Decisões do grilling") e na [#66](https://github.com/Densevolvimento-de-software/moto-chefe/issues/66):

- **O aviso é só gatilho.** A rota acha a inutilização pelo `id` (o `id_externo`, único na tabela) e consulta a NG com a credencial do grupo da linha, pela mesma função do clique "Consultar resultado". O que se grava vem da consulta, nunca do corpo; o grupo sai da linha, nunca do corpo.
- **Separação pelo formato**: corpo com `tipo` é de nota (hoje 200 e ignora); sem `tipo` e com `id`, `numeroInicial` e `numeroFinal` é de inutilização. Os nomes `Autorizada`/`Negada` são iguais nos dois.
- **Respostas**: sem o token no servidor 503; `x-token` ausente ou errado 401; aviso de nota, corpo desconhecido, id não achado, ambiente do aviso diferente do da linha (ou ausente), linha já resolvida, grupo sem credencial no ambiente: 200 sem mudar nada; banco fora ou NG com erro na consulta (5xx, 4xx, rede): 500 para a NG reenviar.
- **Clique e aviso juntos**: a gravação só muda a linha ainda pendente; a resposta que chega depois não desfaz o resultado já gravado.
- **Token**: `NOTAGATEWAY_WEBHOOK_TOKEN`, só no ambiente Production da Vercel, gerado à parte (nunca a API Key). Exceção ao ADR-0010, anotada na "Situação" dele.
- O link recebe avisos de todas as Contas e também do staging e da cópia local (mesma conta da NG): por isso nada do corpo vale como fonte.

## Onde isso vive no MOVA

- `src/app/api/webhooks/notagateway/route.ts`: a rota, fina.
- `src/lib/notagateway/aviso-webhook.ts`: `receberAvisoDaNg`, a ordem das respostas e a linha de console (sem corpo, id, token nem `empresaId`).
- `src/lib/notagateway/aviso.ts`: regras puras (`avisoDeInutilizacao`, `decidirAviso`).
- `src/lib/notagateway/inutilizar.ts`: `inutilizacaoPeloIdExterno` e `consultarResultadoDaLinha`, a consulta que o clique também usa.
- `src/lib/tempo-constante.ts`: a comparação do `x-token`.
