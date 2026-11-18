import { db } from '@/lib/db'
import { nomeDoModeloNaLoja, nomeDoModeloSql } from '@/lib/modelos-da-conta'
import { pedidosVenda, vendas, motos, lojas, grupos, usuarios, modelos, origensVenda } from '@/lib/db/schema'
import { eq, and, ilike, inArray, desc, sql, gte, lte } from 'drizzle-orm'
import { inicioDoDiaBrt, fimDoDiaBrt } from '@/lib/data-venda'
import { freteDaVendaExpr, valorDaMotoNosRelatoriosExpr } from './valor-liquido'
import { pedidoEmAprovacaoSql } from '@/lib/pedido-de-aprovacao'
import { contagemDoPedidoSql } from '@/lib/pedido-venda'

const doPedidoDaVenda = contagemDoPedidoSql(sql.raw('"vendas"."pedido_venda_id"'))

export type PedidoComDetalhes = Awaited<ReturnType<typeof listarPedidosPorLoja>>[0]
export type VendaComDetalhes  = Awaited<ReturnType<typeof listarVendas>>[0]

export async function listarVendas(filtros?: {
  lojaId?: string[]
  modeloId?: string[]
  vendedorId?: string[]
  chassiBusca?: string
  notaFiscal?: string
  dataInicio?: string
  dataFim?: string
}) {
  return db
    .select({
      id:               vendas.id,
      numero:           vendas.numero,
      motoId:           vendas.motoId,
      lojaId:           vendas.lojaId,
      vendedorId:       vendas.vendedorId,
      dataVenda:        vendas.dataVenda,
      valor:            vendas.valor,
      /** Sem o frete cobrado (#796): base do % de desconto. */
      valorMoto:        sql<string>`${valorDaMotoNosRelatoriosExpr()}`,
      formaPagamento:   vendas.formaPagamento,
      pagamentos:       vendas.pagamentos,
      /** Só o frete cobrado (#726), não a Entrega inteira: a lista não precisa do endereço nem de quem recebe. */
      freteCobrado:     sql<number>`(${freteDaVendaExpr()})::float8`,
      clienteNome:      vendas.clienteNome,
      clienteCpf:       vendas.clienteCpf,
      clienteCelular:   vendas.clienteCelular,
      clienteEmail:     vendas.clienteEmail,
      clienteCep:       vendas.clienteCep,
      clienteLogradouro: vendas.clienteLogradouro,
      clienteNumero:    vendas.clienteNumero,
      clienteComplemento: vendas.clienteComplemento,
      clienteBairro:    vendas.clienteBairro,
      clienteCidade:    vendas.clienteCidade,
      clienteEstado:    vendas.clienteEstado,
      representanteNome: vendas.representanteNome,
      representanteCpf:  vendas.representanteCpf,
      clienteIndicadorIe:       vendas.clienteIndicadorIe,
      clienteInscricaoEstadual: vendas.clienteInscricaoEstadual,
      notaFiscalSaida:     vendas.notaFiscalSaida,
      blingNfeId:          vendas.blingNfeId,
      statusConciliacao:   vendas.statusConciliacao,
      conciliadoValor:  sql<number>`COALESCE((
        SELECT SUM(valor_bruto::numeric)
        FROM conciliacoes_cartao
        WHERE venda_id = ${vendas.id}
        AND conciliado = true
      ), 0)`,
      // Fonte única de PIX desde 15/09/2026 (o ValidaPix saiu). Venda anterior a
      // julho/2026, cujo pagamento só existia na tabela antiga, aparece com PIX
      // zerado — histórico em backups/pix_recebimentos_validapix_20260915.json.
      pixConciliadoValor: sql<number>`COALESCE((SELECT SUM(valor::numeric) FROM pix_recebimentos_mcp WHERE venda_id = ${vendas.id}), 0)`,
      // Status de assinatura por tipo, para os ícones da lista. O ORDER BY
      // prioriza o assinado: se houve um cancelado antes e o seguinte foi
      // assinado, o que vale é o assinado.
      contratoStatus: sql<string | null>`(
        SELECT status FROM documentos_assinatura
        WHERE venda_id = ${vendas.id} AND tipo = 'contrato_venda'
        ORDER BY (status = 'assinado') DESC, criado_em DESC LIMIT 1
      )`,
      checklistStatus: sql<string | null>`(
        SELECT status FROM documentos_assinatura
        WHERE venda_id = ${vendas.id} AND tipo = 'checklist_entrega'
        ORDER BY (status = 'assinado') DESC, criado_em DESC LIMIT 1
      )`,
      nfLiberadaEm:     vendas.nfLiberadaEm,
      origemId:         vendas.origemId,
      origemDetalhe:    vendas.origemDetalhe,
      // LEFT JOIN: venda anterior ao deploy da origem não tem linha em origens_venda,
      // e um INNER aqui a apagaria da listagem.
      origemNome:       origensVenda.nome,
      chassi:           motos.chassi,
      cor:              motos.cor,
      modeloId:         motos.modeloId,
      modelo:           nomeDoModeloNaLoja(vendas.lojaId),
      marca:            modelos.marca,
      lojaNome:         lojas.nome,
      vendedorNome:     usuarios.nome,
      // Para escolher o Editar (venda ou pedido) pela mesma `editaPeloPedido` do servidor (#23, P6).
      vendasNoPedido:   doPedidoDaVenda.vendas,
      pecasNoPedido:    doPedidoDaVenda.pecas,
    })
    .from(vendas)
    .innerJoin(motos,    eq(vendas.motoId,     motos.id))
    .innerJoin(modelos,  eq(motos.modeloId,    modelos.id))
    .innerJoin(lojas,    eq(vendas.lojaId,     lojas.id))
    .innerJoin(usuarios, eq(vendas.vendedorId, usuarios.id))
    .leftJoin(origensVenda, eq(vendas.origemId, origensVenda.id))
    .where(
      and(
        filtros?.lojaId !== undefined ? inArray(vendas.lojaId,      filtros.lojaId)                         : undefined,
        filtros?.modeloId?.length    ? inArray(motos.modeloId,      filtros.modeloId)                       : undefined,
        filtros?.vendedorId?.length  ? inArray(vendas.vendedorId,   filtros.vendedorId)                     : undefined,
        filtros?.chassiBusca?.trim() ? ilike(motos.chassi,          `%${filtros.chassiBusca.trim()}%`)      : undefined,
        filtros?.notaFiscal?.trim()  ? ilike(vendas.notaFiscalSaida, `%${filtros.notaFiscal.trim()}%`)     : undefined,
        filtros?.dataInicio           ? gte(vendas.dataVenda, inicioDoDiaBrt(filtros.dataInicio))           : undefined,
        filtros?.dataFim              ? lte(vendas.dataVenda, fimDoDiaBrt(filtros.dataFim))                 : undefined,
      )
    )
    .orderBy(desc(vendas.dataVenda))
}

/**
 * As motos do pedido (#25), para o card e o painel: a do `moto_id` primeiro (o pedido de antes do #774 só tem ela, sem item), depois
 * as dos itens na ordem em que entraram (a mesma regra do motosDoPedido); o modelo com o nome da Conta da loja. Valor em texto
 * ('13000.00'), null quando ainda sem valor. As listas já filtram as lojas do pedido.
 */
const motosDoPedidoSql = sql<{ id: string; marca: string; modelo: string; chassi: string; cor: string; valor: string | null }[]>`coalesce((
  select json_agg(json_build_object('id', mm.id, 'marca', mo.marca, 'modelo', ${nomeDoModeloSql('"mo"', '"mm"."loja_id"')},
    'chassi', mm.chassi, 'cor', mm.cor, 'valor', x.valor::text) order by x.principal desc, x.criado_em, x.item_id)
  from (
    select i.moto_id, i.valor_unitario as valor, i.criado_em, i.id as item_id, i.moto_id = "pedidos_venda"."moto_id" as principal
      from pedidos_venda_itens i
     where i.pedido_venda_id = "pedidos_venda"."id" and i.moto_id is not null
    union all
    select "pedidos_venda"."moto_id", null, null, null, true
     where not exists (select 1 from pedidos_venda_itens i where i.pedido_venda_id = "pedidos_venda"."id" and i.moto_id = "pedidos_venda"."moto_id")
  ) x
  join motos mm on mm.id = x.moto_id
  join modelos mo on mo.id = mm.modelo_id
  -- A moto também na Conta da loja do pedido, mesmo vindo de item já conferido na gravação.
  where exists (select 1 from lojas lm join grupos gm on gm.id = lm.grupo_id, lojas lp join grupos gp on gp.id = lp.grupo_id
                 where lm.id = mm.loja_id and lp.id = "pedidos_venda"."loja_id" and gm.conta_id = gp.conta_id)
), '[]'::json)`

export async function listarPedidosPorLoja(lojaId: string) {
  return db
    .select({
      id: pedidosVenda.id,
      numero: pedidosVenda.numero,
      status: pedidosVenda.status,
      dataPedido: pedidosVenda.dataPedido,
      observacao: pedidosVenda.observacao,
      entrega: pedidosVenda.entrega,
      motoId: pedidosVenda.motoId,
      lojaId: pedidosVenda.lojaId,
      chassi: motos.chassi,
      emAprovacao: pedidoEmAprovacaoSql(sql.raw('"pedidos_venda"."id"')),
      motos: motosDoPedidoSql,
      cor: motos.cor,
      marca: modelos.marca,
      modelo: nomeDoModeloNaLoja(pedidosVenda.lojaId),
      lojaNome: lojas.nome,
      vendedorId: pedidosVenda.vendedorId,
      vendedorNome: usuarios.nome,
    })
    .from(pedidosVenda)
    .innerJoin(motos, eq(pedidosVenda.motoId, motos.id))
    .innerJoin(modelos, eq(motos.modeloId, modelos.id))
    .innerJoin(lojas, eq(pedidosVenda.lojaId, lojas.id))
    .innerJoin(usuarios, eq(pedidosVenda.vendedorId, usuarios.id))
    .where(eq(pedidosVenda.lojaId, lojaId))
    .orderBy(pedidosVenda.dataPedido)
}

export async function listarTodosPedidos(lojaIds?: string[]) {
  return db
    .select({
      id: pedidosVenda.id,
      numero: pedidosVenda.numero,
      status: pedidosVenda.status,
      dataPedido: pedidosVenda.dataPedido,
      observacao: pedidosVenda.observacao,
      entrega: pedidosVenda.entrega,
      motoId: pedidosVenda.motoId,
      lojaId: pedidosVenda.lojaId,
      chassi: motos.chassi,
      emAprovacao: pedidoEmAprovacaoSql(sql.raw('"pedidos_venda"."id"')),
      motos: motosDoPedidoSql,
      cor: motos.cor,
      marca: modelos.marca,
      modelo: nomeDoModeloNaLoja(pedidosVenda.lojaId),
      lojaNome: lojas.nome,
      vendedorId: pedidosVenda.vendedorId,
      vendedorNome: usuarios.nome,
    })
    .from(pedidosVenda)
    .innerJoin(motos, eq(pedidosVenda.motoId, motos.id))
    .innerJoin(modelos, eq(motos.modeloId, modelos.id))
    .innerJoin(lojas, eq(pedidosVenda.lojaId, lojas.id))
    .innerJoin(usuarios, eq(pedidosVenda.vendedorId, usuarios.id))
    .where(lojaIds !== undefined ? inArray(pedidosVenda.lojaId, lojaIds) : undefined)
    .orderBy(pedidosVenda.dataPedido)
}

export async function buscarPedido(id: string) {
  const [pedido] = await db
    .select({
      id: pedidosVenda.id,
      numero: pedidosVenda.numero,
      status: pedidosVenda.status,
      dataPedido: pedidosVenda.dataPedido,
      observacao: pedidosVenda.observacao,
      motoId: pedidosVenda.motoId,
      lojaId: pedidosVenda.lojaId,
      chassi: motos.chassi,
      emAprovacao: pedidoEmAprovacaoSql(sql.raw('"pedidos_venda"."id"')),
      cor: motos.cor,
      motoStatus: motos.status,
      motoLojaId: motos.lojaId,
      marca: modelos.marca,
      modelo: nomeDoModeloNaLoja(pedidosVenda.lojaId),
      lojaNome: lojas.nome,
      vendedorId: pedidosVenda.vendedorId,
      vendedorNome: usuarios.nome,
    })
    .from(pedidosVenda)
    .innerJoin(motos, eq(pedidosVenda.motoId, motos.id))
    .innerJoin(modelos, eq(motos.modeloId, modelos.id))
    .innerJoin(lojas, eq(pedidosVenda.lojaId, lojas.id))
    .innerJoin(usuarios, eq(pedidosVenda.vendedorId, usuarios.id))
    .where(eq(pedidosVenda.id, id))
    .limit(1)
  return pedido ?? null
}

export type VendaComDocumento = Awaited<ReturnType<typeof buscarVenda>>

export async function buscarVenda(id: string) {
  const [venda] = await db
    .select({
      id: vendas.id,
      dataVenda: vendas.dataVenda,
      notaFiscalSaida: vendas.notaFiscalSaida,
      motoId: vendas.motoId,
      lojaId: vendas.lojaId,
      lojaNome: lojas.nome,
      lojaCidade: lojas.cidade,
      grupoNome: grupos.nome,
      marca: modelos.marca,
      modelo: nomeDoModeloNaLoja(vendas.lojaId),
      chassi: motos.chassi,
      cor: motos.cor,
      motor: sql<string>`COALESCE(${motos.motor}, ${modelos.motor})`.as('motor'),
      clienteNome: vendas.clienteNome,
      clienteCpf: vendas.clienteCpf,
      representanteNome: vendas.representanteNome,
      representanteCpf: vendas.representanteCpf,
      clienteLogradouro: vendas.clienteLogradouro,
      clienteNumero: vendas.clienteNumero,
      clienteComplemento: vendas.clienteComplemento,
      clienteBairro: vendas.clienteBairro,
      clienteCidade: vendas.clienteCidade,
      clienteEstado: vendas.clienteEstado,
    })
    .from(vendas)
    .innerJoin(motos, eq(vendas.motoId, motos.id))
    .innerJoin(modelos, eq(motos.modeloId, modelos.id))
    .innerJoin(lojas, eq(vendas.lojaId, lojas.id))
    .innerJoin(grupos, eq(lojas.grupoId, grupos.id))
    .where(eq(vendas.id, id))
    .limit(1)
  return venda ?? null
}
