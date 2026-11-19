# Autenticação na Nota Gateway (token da API)

## O que a doc diz

[Autenticação](https://docs.notagateway.com.br/v2/reference/autentica%C3%A7%C3%A3o) (`updatedAt` 2026-06-10): "A API utiliza um Token Básico para autenticação. Este token deve ser incluído no cabeçalho Authorization de cada requisição"; exemplo `Authorization: Basic <your-access-token>`. "O token é uma string segura e única, emitida para a sua aplicação"; a chave é vista e gerenciada no Dashboard da Nota Gateway. Lido em 18/11/2026.

## O que a doc NÃO diz

- **Formato do token** (tamanho, caracteres aceitos): a página diz só "string segura e única". O MOVA tira espaço e quebra de linha da cópia e aceita só caracteres visíveis (token de API em header de autenticação é ASCII sem espaço, token68 da RFC 7235); não exige tamanho. Decisão: #126. A página aponta o artigo "como obter sua API Key" (https://atendimento.notagateway.com.br/kb/pt-br/article/222600); na tela do MOVA o campo se chama "Token Basic".

## Onde vive no MOVA

- Header: `src/lib/notagateway/client.ts`, função `chamar` (`Authorization: Basic ${cfg.token}`), e `src/lib/notagateway/logo-ng.ts` (envio da logo). O token lido do banco também passa pela normalização (`configNotaGateway`).
- Gravação do token (só admin_geral, cifrado): `salvarCredencial` em `src/lib/notagateway/credencial.ts`; normalização em `src/lib/token-colado.ts` (a mesma do Mercado Pago, #51).
- Tela: `/admin/notas-fiscais` (`notas-fiscais-client.tsx`); o token nunca volta para a tela (`credencial-tela.ts`).
