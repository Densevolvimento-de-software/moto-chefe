// Leituras e gravação dos pagamentos e lançamentos de um alvo da conciliação (venda de moto, OS ou venda
// de peça). Quem chama já conferiu que o alvo abre para o usuário; pagamentos e gravação levam as lojas
// do grupo dentro da consulta. `exec`: o db, ou a transação de quem confere e grava junto.
import { and, eq, inArray, sql } from 'drizzle-orm'
import type { PgSelect } from 'drizzle-orm/pg-core'
import { db } from './db'
import { conciliacoesCartao, ordensServico, pixRecebimentosMcp, vendas, vendasPecas } from './db/schema'
import { pagamentosEfetivosOS, type PgtoOS, semCustoNasForcadasPix } from './conciliacao-status'
import type { AlvoConciliacao } from './conciliacao-alvo'
import { colunasQueLigamAoAlvo } from './alvo-conciliado'
import { CARTAO_ESTORNADO } from './conciliacao-cartao'

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

/**
 * O pedido da venda já tem PIX ligado com custo, do grupo da loja da venda (#93, B6)? Nesse caso a forçada de um
 * PIX da venda não grava custo: o mesmo dinheiro não leva dois. Só venda de moto tem pedido. Quem chama já
 * conferiu que o alvo é do grupo.
 */
export async function pedidoTemPixComCusto(alvo: AlvoConciliacao, exec: ExecutorDoAlvo = db): Promise<boolean> {
  if (alvo.tipo !== 'moto') return false
  // Qualificado à mão: numa query sem join, ${vendas.lojaId} sairia sem a tabela dentro da subconsulta.
  const [r] = await exec.select({
      tem: sql<boolean>`exists (select 1 from pix_recebimentos_mcp pr join lojas lj on lj.id = ${sql.raw('"vendas"."loja_id"')}
        where pr.pedido_id = ${sql.raw('"vendas"."pedido_venda_id"')} and pr.grupo_id = lj.grupo_id and pr.custo_pix > 0)`,
    }).from(vendas).where(eq(vendas.id, alvo.id)).limit(1)
  return Boolean(r?.tem)
}

/**
 * Zera o custo das forçadas de PIX das vendas do pedido, com cada venda travada (#93, S2): o PIX com custo que se
 * liga ao pedido passa a carregar o custo, e o mesmo dinheiro não leva dois. Só nas lojas dadas. Devolve quantas.
 */
export async function semCustoNasForcadasDoPedido(pedidoId: string, lojaIdsGrupo: string[], exec: ExecutorDoAlvo): Promise<number> {
  // Trava sempre na mesma ordem: dois vínculos no mesmo pedido não se travam um ao outro.
  const daVenda = await exec.select({ id: vendas.id }).from(vendas)
    .where(and(eq(vendas.pedidoVendaId, pedidoId), inArray(vendas.lojaId, lojaIdsGrupo)))
    .orderBy(vendas.id)
  return daVenda.reduce(async (soma, { id }) => {
    const antes = await soma
    const alvo = { tipo: 'moto' as const, id }
    const pgtos = await pagamentosDoAlvo(alvo, lojaIdsGrupo, exec, true)
    if (!pgtos) return antes
    const r = semCustoNasForcadasPix(pgtos)
    if (r.zeradas > 0) await gravarPagamentosDoAlvo(alvo, lojaIdsGrupo, r.pgtos, exec)
    return antes + r.zeradas
  }, Promise.resolve(0))
}
