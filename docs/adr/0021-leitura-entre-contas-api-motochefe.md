# 0021. API de leitura entre Contas: só lojas MotoChefe marcadas pelo admin_geral

- **Status:** Aceita
- **Data da decisão:** 2026-11-27
- **Fontes:** issue #315 (spec e decisões do Luis de 27/11/2026); issue #316; #892 (Painel Fábrica,
  `src/lib/painel-fabrica.ts`); ADRs [0017](0017-documento-da-plataforma-fora-das-tabelas-por-grupo.md),
  [0018](0018-conta-acima-do-grupo.md) e [0019](0019-admin-rede-acesso-entre-contas.md)
- **Revisa:** [0018](0018-conta-acima-do-grupo.md)

## Contexto

A MotoChefe Brasil acompanha a rede por um dashboard próprio. Do MOVA ela só enxerga o Painel
Fábrica (#892): estoque e vendas de moto, tela a tela, com a loja identificada pelo login do portal
da fábrica e uma lista de campos fixada para a fábrica. Vendas de peça, ordens de serviço, metas,
despesas e cadastro de vendedores e técnicos não saem. Para ter isso no dashboard, alguém exportava
à mão.

O ADR-0018 isola cada Conta: toda leitura filtra pela Conta de quem pede. A API lê várias Contas de
propósito, sem sessão e sem grupo ativo. Essa exceção precisa ficar escrita antes do código.

## Decisão

A API de leitura é uma exceção ao isolamento por Conta, e só nestes pontos:

- **Loja MotoChefe é marcação da loja.** É uma coluna própria da loja, desligada por padrão. Só o
  `admin_geral` liga e desliga, pela tela de marcação. O servidor confere o papel na gravação, e o
  cadastro comum de loja não grava esse campo. Não se deriva do login do portal da fábrica, de nome,
  marca ou CNPJ. Nenhuma loja sai enquanto não for marcada.
- **A marcação vale pela loja de cada registro.** Venda, OS, meta, despesa e pessoa saem só quando a
  loja de cada um está marcada. Parâmetro de loja, grupo ou Conta no pedido não amplia o que sai.
  Contagem e paginação não contam registro de loja de fora.
- **Custo de compra, despesas e metas exigem autorização da Conta.** Só saem da Conta que o
  `admin_geral` autorizou. Loja marcada de Conta não autorizada sai com o custo nulo e sem linhas de
  despesa ou de meta; o resto da loja sai normal. A lista de Contas autorizadas mora no banco, nunca
  no código. A primeira Conta autorizada é achada por dado do banco na migração, sem nome nem CNPJ no
  arquivo.
- **Lista fechada por conjunto.** Só estes campos saem. Campo novo no banco não sai sozinho.
  - **Lojas:** id, nome, cidade, endereço, CEP e ativa.
  - **Pessoas** (vendedores e técnicos das lojas marcadas): id, nome, função, loja e ativo. Sem
    e-mail, documento, telefone ou dado de folha.
  - **Vendas de moto:** só motos da marca MotoChefe (mesma regra de marca do Painel Fábrica). Data,
    número, loja, vendedor, modelo, cor, chassi, valor da moto, custo de compra, CEP do cliente,
    número da NF de saída e data do cancelamento (nula se a venda vale). Venda cancelada sai marcada,
    com essa data. Sem forma de pagamento.
  - **Vendas de peça:** uma linha por item, com data, número da venda, loja, vendedor, peça,
    quantidade e valor. Sem custo e sem filtro de marca.
  - **Ordens de serviço:** todas as da loja, com qualquer status. Datas de abertura e conclusão,
    status, loja, técnico, chassi (ou marca e modelo, quando a moto é de fora) e itens (tipo peça ou
    mão de obra, quantidade e valor). Sem custo.
  - **Metas:** loja, ano, mês e valor.
  - **Despesas:** soma por mês, loja, categoria e grupo do DRE. Sem lançamento individual, descrição
    ou beneficiário. O nome da categoria sai como a Conta cadastrou.
  - Em todos, o id que sai é o identificador do MOVA de loja e de pessoa, só para ligar um conjunto ao
    outro. Fora da lista: cliente da OS (fica para depois), descrição livre de OS e de item, e qualquer
    outro campo.
- **Chave de acesso é dado da plataforma**, sem grupo, em tabela própria, como no ADR-0017. Não fica
  a chave em claro: fica só o resumo dela, quem gerou, quando, quando foi revogada e até quando a
  anterior vale. A chave aparece uma única vez, na geração. O `admin_geral` gera, troca e revoga pela
  tela. Na troca, a chave antiga segue válida por um prazo curto (24 horas). Revogação vale na hora.
  Uma chave ativa por vez em produção. O ambiente de teste tem a sua, com dado sintético. Não há
  variável de ambiente nova para a chave.
- **Limite e registro de acesso.** Há limite de chamadas por minuto por chave, contado no banco. Cada
  chamada fica registrada em tabela própria da plataforma, inclusive a recusada. O registro é guardado
  por 12 meses, pela rotina que já apaga o log antigo, e nesta fatia não tem tela. Falha ao registrar
  não derruba a resposta.
- **Erro sem vazamento.** Qualquer falha de chave recebe a mesma resposta de acesso negado, sem dado.
  Nenhuma mensagem diz se loja, venda ou Conta existe.
- **Fronteira num lugar só.** Um módulo puro decide quais lojas saem, quais Contas liberam custo,
  despesa e meta, e quais colunas cada conjunto devolve. Toda consulta passa por ele, com o filtro
  dentro da própria consulta. As rotas só conferem a chave, o limite e os parâmetros.
- **Ações sensíveis no log de ações:** marcar loja, autorizar Conta e gerar, trocar ou revogar chave.

Regras que a spec da #315 fixou e que o Luis ainda não confirmou um a um (conforme a spec da #315):

- **Datas e valores.** Datas em ISO 8601, em UTC. Campo que guarda só o dia sai só com o dia. Valores
  em reais, com duas casas.
- **Loja desmarcada.** Desmarcar tira a loja de todas as respostas na hora, inclusive do histórico.
  Loja marcada e desativada continua no histórico, indicada como inativa.
- **Despesa "empresa geral"** (sem loja). Sai somada por CNPJ, e só de Conta autorizada, quando o CNPJ
  tem ao menos uma loja marcada. Efeito: um CNPJ com uma única loja marcada expõe a despesa geral do
  CNPJ inteiro, que não é da loja marcada.
- **Painel Fábrica não muda.** Segue com a regra dele neste ADR.

## Por quê

- O dashboard da MotoChefe Brasil precisa de dado que a fábrica não vê hoje. Exportar à mão não escala
  e erra.
- A marcação é própria da loja, e não o `fabrica_email`. Esse campo é preenchido pelo formulário de
  loja, que qualquer admin com acesso à tela edita (`src/app/(dashboard)/admin/lojas/actions.ts`).
  Preenchê-lo numa loja que não é da fábrica passaria a exportar custo, despesa e CEP dela.
- Custo, margem, despesas e metas são dado de negócio de cada Conta. O acordo para sair é da Conta.
- Chave em tabela, e não em variável de ambiente: troca e revogação acontecem sem deploy, e cada
  chave tem dono e registro.
- Lista de campos num ponto só: um endpoint novo não esquece o filtro.

## Alternativas descartadas

- **Derivar a loja MotoChefe do `fabrica_email`:** ver "Por quê".
- **Chave em variável de ambiente:** troca pede deploy e não revoga uma chave só.
- **Chave cifrada, como a credencial do ADR-0010:** a chave não precisa voltar em claro. Guardar só o
  resumo basta e não cria uma segunda chave-mestra a proteger.
- **Registro na `log_acoes`:** o `usuario_id` é obrigatório e o tipo de ação tem check no banco. Acesso
  de chave não é usuário. Tabela própria, como no ADR-0017.
- **Limite pelo firewall da Vercel:** fica fora do banco e não conta por chave. Decidido: contador no
  banco, junto da chave.
- **Uma chave por loja ou por pessoa; escopo por endpoint:** vira sistema de permissão sem pedido.
  Fica para depois.
- **Aviso a cada venda (webhook), arquivo CSV ou planilha:** fora do escopo. A API é consulta sob
  demanda.
- **Autorização de Conta por aceite do admin da Conta (ADR-0018 original):** já substituída pelo 0019.
  Aqui quem libera é o `admin_geral`.

## Situação em 2026-11-27

Nada implementado. Migração, chave, marcação, endpoints e telas saem nos tickets #317 a #326. As duas
telas do `admin_geral` (marcar lojas e chave) precisam de protótipo aprovado pelo Luis antes do código.

## O que muda em relação ao #892 e ao ADR-0018

- **#892 (Painel Fábrica):** a fábrica vê só data, número, loja, modelo, cor, chassi e valor da moto,
  e a loja é a do login do portal. Isso continua valendo para o Painel. A API sai com outra lista de
  campos e outra marcação de loja. O comentário do topo de `src/lib/painel-fabrica.ts` descreve só o
  Painel e não vale para a API.
- **ADR-0018:** a regra "toda leitura filtra pela Conta" ganha esta exceção, limitada às lojas marcadas
  e às colunas listadas aqui. A regra de acesso entre Contas do ADR-0019 não muda.
- **ADR-0017:** chave e registro de acesso moram em tabelas da plataforma, sem `grupo_id`, como o
  contrato de adesão.

## Quando revisar

- O Painel Fábrica passar a usar a marcação de loja: a regra "loja MotoChefe" vira uma só.
- Pedido de chave por pessoa, por loja ou de escopo por endpoint.
- A segunda fatia (estoque de fim de mês e taxas de cartão) entrar.
- Uma Conta pedir para sair da API: a autorização é desligada e a decisão volta para revisão.
