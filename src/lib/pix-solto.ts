/**
 * PIX recebido sem alvo: as colunas do vínculo e o que ele gravou (valor do PIX, custo e taxa, #90).
 * Todo lugar que solta um PIX usa este (desvincular, apagar venda, excluir venda de peça). Módulo puro:
 * quem só solta dentro de uma transação não carrega o banco por importar a constante.
 */
export const PIX_SOLTO = {
  tipoCorrespondencia: null, vendaId: null, osId: null, pedidoId: null, pecaVendaId: null, lancadoPorId: null, lancadoEm: null,
  valorBruto: null, custoPix: null, custoPixTaxa: null,
} as const
