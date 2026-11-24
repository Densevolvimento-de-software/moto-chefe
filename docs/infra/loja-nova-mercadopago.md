# Loja nova com Mercado Pago

Roteiro curto para um grupo que passa a usar a maquininha Mercado Pago (Point). São dois cadastros
separados; sem os dois, a venda aparece, mas o relatório da maquininha não entra sozinho. Sem dado de
cliente aqui: o token e o CNPJ ficam só no cadastro do grupo.

## 1. Maquininha em Cadastros → Maquininhas

Quem cadastra: `admin_geral` ou `admin_socio` (o menu Cadastros → Maquininhas é só deles). Em `/admin/maquininhas`, "Nova maquininha":

- Operadora: **Mercado Pago**.
- Nome na tela: o nome que o vendedor escolhe no pagamento (ex.: "Point loja").

A coluna "Conciliação" mostra:

- **Integração**: o grupo já tem o token; as vendas com Point entram pela integração.
- **Integração sem token**: falta o token (passo 2). Até lá, nada é importado.

## 2. Token do Mercado Pago em Grupos

Quem cadastra: só `admin_geral`, no Editar Grupo (campo do Mercado Pago). O token é gravado cifrado
e não volta para a tela. Depois de salvar, a coluna da maquininha deixa de dizer "Integração sem
token".

## Conferir

- Em `/admin/maquininhas`, a coluna mostra "Integração" (não "Manual").
- Em `/conciliacao`, o bloco "Conciliação manual" não cita o Mercado Pago.
- A faixa do Mercado Pago aparece em `/conciliacao` com a data da última importação.

Regra de fundo: a operadora Mercado Pago não usa o upload de relatório; quem importa é a integração
(ver `src/lib/operadoras.ts`).
