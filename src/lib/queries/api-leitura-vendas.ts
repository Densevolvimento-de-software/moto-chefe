// Consulta da API de vendas de moto (#323, ADR-0021). Lê várias Contas de propósito, sem sessão: o filtro de loja
// (lojasQueSaem, o mesmo de /lojas) e o de marca (o do Painel Fábrica) ficam dentro da consulta. As colunas saem só
// pelo mapeamento puro em @/lib/api-leitura-vendas.
import { and, asc, desc, eq, gte, inArray, isNotNull, lte, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { contas, grupos, lojas, modelos, motos, notasFiscaisSaida, usuarios, vendas } from '@/lib/db/schema'
import { fimDoDiaBrt, inicioDoDiaBrt } from '@/lib/data-venda'
import { STATUS_FINAIS_VIVAS } from '@/lib/notagateway/status'
import { custoMotoExpr } from '@/lib/queries/custo-moto'
import { corExibida, marcaDoPainel, modeloExibido, valorDaMoto } from '@/lib/queries/painel-fabrica'
import { custoDaContaExpr, lojasQueSaem } from '@/lib/queries/api-leitura'
import {
  codificarCursor, cortarPagina, cursorDaUltimaLinha, linhaDaVendaMoto, TAMANHO_DA_PAGINA, type Cursor,
  type LinhaVendaMotoBanco, type Periodo, type VendaMotoDaApi,
} from '@/lib/api-leitura-vendas'

// Data da venda até o milissegundo: a ordem usa este valor, e o cursor leva o mesmo. Sem o corte, um
// microssegundo do banco faria a página seguinte repetir a última linha.
const dataDaOrdem = sql<Date>`date_trunc('milliseconds', ${vendas.dataVenda})`

// NF de saída de produção viva, com número (a lista de mortas mora em status.ts). A subconsulta devolve no máximo
// uma linha, então a venda nunca se duplica mesmo que haja mais de uma nota viva (uma de homologação, por exemplo).
const numeroDaNfViva = () => db
  .select({ numero: notasFiscaisSaida.numero })
  .from(notasFiscaisSaida)
  .where(and(
    eq(notasFiscaisSaida.vendaId, sql.raw('"vendas"."id"')),
    eq(notasFiscaisSaida.ambiente, 'Producao'),
    inArray(notasFiscaisSaida.status, STATUS_FINAIS_VIVAS),
    isNotNull(notasFiscaisSaida.numero),
  ))
  .orderBy(desc(notasFiscaisSaida.criadoEm), desc(notasFiscaisSaida.id))
  .limit(1)

/** Uma página de vendas de moto MotoChefe das lojas que saem, no período (dias de Brasília), depois do cursor. */
export async function listarVendasMotoDaApi(
  periodo: Periodo,
  cursor: Cursor | null,
): Promise<{ vendas: VendaMotoDaApi[]; proximaPagina: string | null }> {
  const depoisDoCursor = cursor
    ? sql`(${dataDaOrdem}, ${vendas.numero}) > (${cursor.d}::timestamptz, ${cursor.n}::integer)`
    : undefined
  const linhas: LinhaVendaMotoBanco[] = await db
    .select({
      // A coluna (e não o sql cru): o drizzle entrega Date. O JS corta no milissegundo, como o date_trunc da ordem.
      dataVenda: vendas.dataVenda,
      numero: vendas.numero,
      lojaId: lojas.id,
      lojaNome: lojas.nome,
      vendedorId: usuarios.id,
      vendedorNome: usuarios.nome,
      modelo: modeloExibido,
      cor: corExibida,
      chassi: motos.chassi,
      valor: valorDaMoto,
      contaAutorizada: contas.autorizaCustoDespesaMeta,
      custo: custoDaContaExpr(custoMotoExpr()),
      cepCliente: vendas.clienteCep,
      numeroNf: sql<string | null>`(${numeroDaNfViva()})`,
    })
    .from(vendas)
    .innerJoin(motos, eq(vendas.motoId, motos.id))
    .innerJoin(modelos, eq(motos.modeloId, modelos.id))
    .innerJoin(lojas, eq(vendas.lojaId, lojas.id))
    .innerJoin(grupos, eq(lojas.grupoId, grupos.id))
    .innerJoin(contas, eq(grupos.contaId, contas.id))
    .innerJoin(usuarios, eq(vendas.vendedorId, usuarios.id))
    .where(and(
      inArray(lojas.id, lojasQueSaem()),
      marcaDoPainel(),
      gte(vendas.dataVenda, inicioDoDiaBrt(periodo.de)),
      lte(vendas.dataVenda, fimDoDiaBrt(periodo.ate)),
      depoisDoCursor,
    ))
    .orderBy(asc(dataDaOrdem), asc(vendas.numero))
    .limit(TAMANHO_DA_PAGINA + 1)

  const pagina = cortarPagina(linhas)
  const ultima = pagina.linhas[pagina.linhas.length - 1]
  return {
    vendas: pagina.linhas.map(linhaDaVendaMoto),
    proximaPagina: pagina.temMais && ultima ? codificarCursor(cursorDaUltimaLinha(ultima)) : null,
  }
}
