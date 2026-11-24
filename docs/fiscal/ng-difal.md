# DIFAL na NF-e interestadual (Nota Gateway)

## Regra fiscal

Venda interestadual para consumidor final que não contribui com ICMS leva o grupo do DIFAL (`ICMSUFDest`) no XML. Com mercadoria de origem 2, a SEFAZ exige `pICMSInter` de 4% e recusa a nota com a rejeição 697 se vier outro valor.

- Fonte desta regra: o suporte da NG (Hermes, 24/11/2026, comentário da #247), que cita a NT 2015.003. **O texto da NT não foi lido por nós**; conferir antes de citar o item como lei.

## Contrato JSON da Nota Gateway

- [Emitir NF-e](https://docs.notagateway.com.br/v2/reference/emitir-nota-fiscal-nfe) (`updatedAt` 2026-06-16): **não lista** nenhum campo de DIFAL no objeto `icms` (conferido em 24/11/2026 com `curl <página>.md | grep -i "difal\|UFDest\|fcp"`, sem resultado).
- Manual da NG para NF-e modelo 55 (`ng-nfe-modelo55.txt`, arquivo de 23/10/2026 guardado fora do repo) lista, em `itens[].impostos.icms`, todos `double` e opcionais:
  - `baseCalculoUFDestinoDifal`: "Valor da base de cálculo do ICMS na UF de Destino";
  - `aliquotaUFDestinoDifal`: "Alíquota da UF de destino do DIFAL";
  - `valorUFDestinoDifal`: "Valor do ICMS Interestadual para a UF de Destino";
  - `valorUFOrigemDifal`: "Valor do ICMS Interestadual para a UF de Origem";
  - `aliquotaInterestadualDifal`: "Alíquota Interestadual do DIFAL";
  - `baseCalculoFundoCombatePobrezaDifal`, `percentualFCPDifal`, `valorFCPDifal`: base, percentual e valor do FCP do DIFAL.
- `percentualPartilhaInterestadualDifal` **não está no manual nem na página**. O nome vem do JSON de uma nota que o suporte da NG (Hermes) consultou em 24/11/2026. O MOVA manda 100 (partilha toda para o destino).

## O que a doc NÃO diz

- O que a NG faz quando o pedido não traz o DIFAL: pelo XML enviado pelo Hermes (comentário da #247, 24/11/2026), ela monta `ICMSUFDest` com `pICMSInter` 12 e `pICMSUFDest` 18, a interestadual da dupla de UFs e uma interna que ela escolhe. Por isso a nota de origem 2 foi recusada.
- A alíquota interna do estado do comprador e o FCP: a NG não os calcula nem os confere. O Hermes orientou conferir com a contabilidade (#247).
- Os campos de DIFAL na emissão são o "ajuste que o Hermes sugeriu" para uma nota recusada (#247); a confirmação é o teste em homologação (`pICMSUFDest` e `vICMSUFDest` no XML).

## Escopo no MOVA (hotfix v1.42.1, #247)

- Só NF-e interestadual para consumidor final **não contribuinte** (decisão do Luis). Interna, contribuinte e isento seguem sem o grupo.
- Alíquota interna do destino e FCP: digitados por quem emite, na tela da emissão e da recusa. Sem tabela por UF e sem migração; a tabela da `feature/nf-endereco-entrega` substitui o campo digitado quando entrar.
- Sem a alíquota interna a emissão é recusada pelo servidor, com frase clara, antes de gravar RENAVE ou nota.
- Valores: base única. `valorUFDestinoDifal = base × (interna − interestadual) / 100` e `valorFCPDifal = base × FCP / 100`, arredondados ao centavo. Exemplo: base 9.900, interna 12, interestadual 4 dá 792. `valorUFOrigemDifal` 0, `aliquotaInterestadualDifal` é a da regra de saída do grupo.
- Consumidor final **isento** também tem DIFAL pela lei; fica fora deste hotfix.

Arquivos: `src/lib/notagateway/difal.ts` (regra pura), `src/lib/notagateway/payload.ts` (`difalDaVenda`, grupo no `icms`), `src/app/(dashboard)/vendas/nfe-propria-actions.ts` (validação no servidor) e `src/app/(dashboard)/estoque/components/difal-form.tsx` (tela).

Validação ponta a ponta depende de emitir em homologação e ler o XML. Nenhuma validação em produção foi feita ou está autorizada.
