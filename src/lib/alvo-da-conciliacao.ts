// Leituras e gravação dos pagamentos e lançamentos de um alvo da conciliação (venda de moto, OS ou venda
// de peça). Quem chama já conferiu que o alvo abre para o usuário; pagamentos e gravação levam as lojas
// do grupo dentro da consulta. `exec`: o db, ou a transação de quem confere e grava junto.
import { and, eq, inArray, sql } from 'drizzle-orm'
import type { PgSelect } from 'drizzle-orm/pg-core'
import { db, execRows } from './db'
import { conciliacoesCartao, ordensServico, pixRecebimentosMcp, vendas, vendasPecas } from './db/schema'
import { pagamentosEfetivosOS, type PgtoOS } from './conciliacao-status'
import type { AlvoConciliacao } from './conciliacao-alvo'
import { colunasQueLigamAoAlvo } from './alvo-conciliado'
import { CARTAO_ESTORNADO } from './conciliacao-cartao'
import { pixComCustoDoPedido, pixDasVendasDoPedido } from './queries/valor-liquido'
import type { CoberturaDaVenda } from './custo-pix'

export type ExecutorDoAlvo = Pick<typeof db, 'select' | 'update'>

// `for update` só quando pedido; fora de transação não segura nada.
const travarSe = <Q extends PgSelect>(travar: boolean, q: Q) => (travar ? q.for('update') : q)

// Cartões conciliados ao alvo.
export function cartoesDoAlvo(alvo: AlvoConciliacao, exec: ExecutorDoAlvo = db) {
  const coluna = colunasQueLigamAoAlvo(alvo).cartao

  return exec
    .select({
      id:            conciliacoesCartao.id,
      autorizacao:   conciliacoesCartao.autorizacao,
      valorBruto:    conciliacoesCartao.valorBruto,
      valorLiquido:  conciliacoesCartao.valorLiquido,
      operadora:     conciliacoesCartao.operadora,
      tipo:          conciliacoesCartao.tipo,
      dataTransacao: conciliacoesCartao.dataTransacao,
    })
    .from(conciliacoesCartao)
    .where(and(eq(coluna, alvo.id), eq(conciliacoesCartao.conciliado, true)))
}

// Linhas da maquininha ligadas ao alvo e estornadas no Mercado Pago (#51): o painel diz que o pagamento voltou.
export function estornosDoAlvo(alvo: AlvoConciliacao) {
  return db
    .select({ id: conciliacoesCartao.id, valorBruto: conciliacoesCartao.valorBruto, tipo: conciliacoesCartao.tipo })
    .from(conciliacoesCartao)
    .where(and(eq(colunasQueLigamAoAlvo(alvo).cartao, alvo.id), eq(conciliacoesCartao.status, CARTAO_ESTORNADO)))
}

// PIX vinculados ao alvo.
export function pixDoAlvo(alvo: AlvoConciliacao, exec: ExecutorDoAlvo = db) {
  // Fonte única desde 15/09/2026: o PIX do ValidaPix saiu junto com a
  // integração. Venda de antes de julho/2026, cujo pagamento só existia lá,
  // aparece aqui sem PIX — o dado está em
  // backups/pix_recebimentos_validapix_20260915.json.
  const coluna = colunasQueLigamAoAlvo(alvo).pix

  return exec
    .select({
      id:            pixRecebimentosMcp.id,
      dataPagamento: pixRecebimentosMcp.data,
      valor:         pixRecebimentosMcp.valor,
      pagadorNome:   pixRecebimentosMcp.pagadorNome,
      observacao:    pixRecebimentosMcp.descricao,
      // Gravados no vínculo (#90): o PIX cobre o pagamento pelo valor do PIX, não pelo crédito.
      valorBruto:    pixRecebimentosMcp.valorBruto,
      custoPix:      pixRecebimentosMcp.custoPix,
      custoPixTaxa:  pixRecebimentosMcp.custoPixTaxa,
    })
    .from(pixRecebimentosMcp)
    .where(eq(coluna, alvo.id))
}

// Pagamentos do alvo, só se ele for de uma loja do grupo ativo (escopo dentro da consulta). `travar`: dentro de uma
// transação, segura a linha do alvo até o fim dela (quem confere e grava no mesmo alvo espera a vez).
export async function pagamentosDoAlvo(alvo: AlvoConciliacao, lojaIdsGrupo: string[], exec: ExecutorDoAlvo = db, travar = false): Promise<PgtoOS[] | null> {
  if (alvo.tipo === 'peca') {
    const [r] = await travarSe(travar, exec
      .select({ pagamentos: vendasPecas.pagamentos })
      .from(vendasPecas)
      .where(and(eq(vendasPecas.id, alvo.id), inArray(vendasPecas.lojaId, lojaIdsGrupo)))
      .limit(1)
      .$dynamic())
    return r ? ((r.pagamentos ?? []) as PgtoOS[]) : null
  }

  if (alvo.tipo === 'os') {
    const [r] = await travarSe(travar, exec
      .select({
        pagamentos:     ordensServico.pagamentos,
        formaPagamento: ordensServico.formaPagamento,
        valorTotal:     ordensServico.valorTotal,
      })
      .from(ordensServico)
      .where(and(eq(ordensServico.id, alvo.id), inArray(ordensServico.lojaId, lojaIdsGrupo)))
      .limit(1)
      .$dynamic())
    // OS antiga só tem `formaPagamento` em texto — materializa o array sintetizado
    // para que a marcação tenha onde morar.
    return r ? pagamentosEfetivosOS(r.formaPagamento, r.pagamentos, r.valorTotal) : null
  }

  const [r] = await travarSe(travar, exec
    .select({ pagamentos: vendas.pagamentos })
    .from(vendas)
    .where(and(eq(vendas.id, alvo.id), inArray(vendas.lojaId, lojaIdsGrupo)))
    .limit(1)
    .$dynamic())
  return r ? ((r.pagamentos ?? []) as PgtoOS[]) : null
}

// Grava com o mesmo escopo da leitura: o update não confia só no id.
export async function gravarPagamentosDoAlvo(alvo: AlvoConciliacao, lojaIdsGrupo: string[], pgtos: PgtoOS[], exec: ExecutorDoAlvo = db) {
  if (alvo.tipo === 'peca') {
    await exec.update(vendasPecas).set({ pagamentos: pgtos })
      .where(and(eq(vendasPecas.id, alvo.id), inArray(vendasPecas.lojaId, lojaIdsGrupo)))
  } else if (alvo.tipo === 'os') {
    await exec.update(ordensServico).set({ pagamentos: pgtos })
      .where(and(eq(ordensServico.id, alvo.id), inArray(ordensServico.lojaId, lojaIdsGrupo)))
  } else {
    await exec.update(vendas).set({ pagamentos: pgtos })
      .where(and(eq(vendas.id, alvo.id), inArray(vendas.lojaId, lojaIdsGrupo)))
  }
}

/** A cobertura do pedido da venda para a linha da forçada de PIX (`CoberturaDaVenda`), nas lojas do grupo da loja da venda. */
export async function coberturaDoPedidoDaVenda(vendaId: string): Promise<CoberturaDaVenda | null> {
  const [pedido, grupo] = [sql.raw('v.pedido_venda_id'), sql.raw('lj.grupo_id')]
  const [r] = (await execRows(sql`select ${pixComCustoDoPedido(pedido, grupo)} as pix,
      ${pixDasVendasDoPedido(pedido, grupo, sql.raw('v.id'))} as outras
    from vendas v join lojas lj on lj.id = v.loja_id where v.id = ${vendaId}`)) as { pix: string; outras: string }[]
  return r ? { pixDoPedido: Number(r.pix), pixDasOutras: Number(r.outras) } : null
}

/**
 * Quantas forçadas de PIX com custo as vendas do pedido têm, nas lojas do grupo (#93, decisões 9 e 10): ligar ao
 * pedido um PIX com custo faz a parte coberta delas deixar de contar, e a tela avisa. Só lê.
 */
export async function forcadasPixComCustoDoPedido(pedidoId: string, grupoId: string): Promise<number> {
  const [r] = (await execRows(sql`select count(*)::int as n
    from vendas v cross join lateral jsonb_array_elements(coalesce(v.pagamentos, '[]'::jsonb)) pg
    where v.pedido_venda_id = ${pedidoId} and v.loja_id in (select id from lojas where grupo_id = ${grupoId})
      and (pg->'conciliadoManual'->'pix'->>'custoPix')::numeric > 0`)) as { n: number }[]
  return r?.n ?? 0
}
