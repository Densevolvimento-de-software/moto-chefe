import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { idDoInsert, semearContaBase, semearModelo, semearUsuario, type Base, type Executor } from '@/test/semear-conta'
import { colunasDoAlvo, type AlvoConciliacao, type AlvoTipo } from '@/lib/conciliacao-alvo'

/**
 * Os três alvos da conciliação (venda de moto, venda de peça e OS) com `pagamentos`, para os testes
 * de banco. `usuarioId` é quem vende ou abre a OS; `em`, a data da venda e da conclusão da OS (sem
 * ela, a venda fica com a do banco e a OS sem conclusão). A forma de pagamento é a do 1º pagamento.
 */
export type Balcao = { lojaId: string; usuarioId: string; modeloId: string; em?: string }
export type Pagamentos = Record<string, unknown>[]

const jsonDe = (p: Pagamentos) => sql`${JSON.stringify(p)}::jsonb`
const formaDe = (p: Pagamentos) => String(p[0]?.tipo ?? 'dinheiro')
const totalDe = (p: Pagamentos) => p.reduce((soma, x) => soma + Number(x.valor ?? 0), 0)
const dataOuPadrao = (em?: string) => em ? sql`${em}::timestamptz` : sql`default`

/** `o.valor`: o da venda (padrão, a soma dos pagamentos); `o.pedidoId`: outra venda do mesmo pedido (pedido com várias motos). */
export async function semearVendaMoto(tx: Executor, b: Balcao, pagamentos: Pagamentos, o: { valor?: number; pedidoId?: string } = {}) {
  const moto = await idDoInsert(tx, sql`insert into motos (chassi, modelo_id, loja_id, cor, nota_fiscal_entrada, status, disponibilidade)
    values (${randomUUID()}, ${b.modeloId}, ${b.lojaId}, 'CINZA', '1', 'vendida', 'vendida') returning id`)
  const pedido = o.pedidoId ?? await idDoInsert(tx, sql`insert into pedidos_venda (moto_id, loja_id, vendedor_id) values (${moto}, ${b.lojaId}, ${b.usuarioId}) returning id`)
  return idDoInsert(tx, sql`insert into vendas (pedido_venda_id, moto_id, loja_id, vendedor_id, efetivado_por, cliente_nome, cliente_cpf, valor, forma_pagamento, pagamentos, data_venda)
    values (${pedido}, ${moto}, ${b.lojaId}, ${b.usuarioId}, ${b.usuarioId}, 'Cliente sintético', '52998224725', ${o.valor ?? totalDe(pagamentos)}, ${formaDe(pagamentos)},
      ${jsonDe(pagamentos)}, ${dataOuPadrao(b.em)}) returning id`)
}

export function semearVendaPeca(tx: Executor, b: Pick<Balcao, 'lojaId' | 'usuarioId' | 'em'>, pagamentos: Pagamentos) {
  return idDoInsert(tx, sql`insert into vendas_pecas (loja_id, vendedor_id, forma_pagamento, pagamentos, valor_total, data_venda)
    values (${b.lojaId}, ${b.usuarioId}, ${formaDe(pagamentos)}, ${jsonDe(pagamentos)}, ${totalDe(pagamentos)},
      ${dataOuPadrao(b.em)}) returning id`)
}

export function semearOs(tx: Executor, b: Pick<Balcao, 'lojaId' | 'usuarioId' | 'em'>, pagamentos: Pagamentos) {
  return idDoInsert(tx, sql`insert into ordens_servico (loja_id, aberta_por, descricao, status, pagamentos, data_conclusao)
    values (${b.lojaId}, ${b.usuarioId}, 'revisão', 'concluida', ${jsonDe(pagamentos)}, ${b.em ?? null}::timestamptz) returning id`)
}

/**
 * PIX recebido do banco (Open Finance), no grupo, com data de agora. Livre, ou já vinculado à venda ou ao pedido
 * com o que o vínculo grava (`vinculado`: valor do PIX e custo; a taxa sai deles).
 */
export function semearPixRecebido(tx: Executor, grupoId: string, o: {
  valor: number; pagadorNome?: string; tipoOperacao?: string | null
  vinculado?: { venda?: string; pedido?: string; os?: string; peca?: string; valorBruto: number; custoPix: number }
}) {
  const v = o.vinculado
  const tipo = !v ? null : v.venda ? 'venda' : v.os ? 'os' : v.peca ? 'peca' : 'pedido'
  return idDoInsert(tx, sql`insert into pix_recebimentos_mcp (grupo_id, conta_id, banco, transacao_id, data, valor, pagador_nome, tipo_operacao,
      tipo_correspondencia, venda_id, pedido_id, os_id, peca_venda_id, valor_bruto, custo_pix, custo_pix_taxa)
    values (${grupoId}, 'conta-sintetica', 'Banco sintético', ${randomUUID()}, now(), ${o.valor}, ${o.pagadorNome ?? 'Pagador sintético'},
      ${o.tipoOperacao === undefined ? 'PIX' : o.tipoOperacao},
      ${tipo}, ${v?.venda ?? null}, ${v?.pedido ?? null}, ${v?.os ?? null}, ${v?.peca ?? null},
      ${v?.valorBruto ?? null}, ${v?.custoPix ?? null}, ${v ? (v.valorBruto > 0 ? v.custoPix / v.valorBruto : 0) : null}) returning id`)
}

/**
 * Linha da conciliação de cartão ligada ao alvo e conciliada. `tipo` 'pix' é o Pix da maquininha Mercado Pago;
 * 'credito' ou 'debito', cartão.
 */
export function semearLinhaDaMaquininha(tx: Executor, grupoId: string, o: { valor: number; alvo: AlvoConciliacao; tipo?: string }) {
  const { vendaId, pecaVendaId, osId } = colunasDoAlvo(o.alvo)
  return idDoInsert(tx, sql`insert into conciliacoes_cartao (grupo_id, operadora, data_transacao, valor_bruto, tipo, venda_id, peca_venda_id, os_id, conciliado)
    values (${grupoId}, 'mercadopago', '2026-11-19', ${o.valor}, ${o.tipo ?? 'pix'}, ${vendaId}, ${pecaVendaId}, ${osId}, true) returning id`)
}

/** Conta nova com uma venda de moto, uma OS e uma venda de peça, todas com os mesmos `pagamentos`. */
export async function semearContaComAlvos(tx: Executor, prefixo: string, pagamentos: Pagamentos): Promise<Base & { alvos: Record<AlvoTipo, string>; balcao: Balcao }> {
  const suf = randomUUID()
  const base = await semearContaBase(tx, { prefixo, nome: suf, cnpj: suf })
  const balcao = { lojaId: base.lojaId, usuarioId: await semearUsuario(tx, base, { papel: 'vendedor' }), modeloId: await semearModelo(tx, `${prefixo} ${suf}`) }
  return {
    ...base,
    balcao,
    alvos: {
      moto: await semearVendaMoto(tx, balcao, pagamentos),
      os:   await semearOs(tx, balcao, pagamentos),
      peca: await semearVendaPeca(tx, balcao, pagamentos),
    },
  }
}

/** Custo do PIX do grupo na configuração de taxas (fração: 0.002 = 0,20%). */
export const semearCustoPixDoGrupo = (tx: Executor, grupoId: string, taxa: number) =>
  tx.execute(sql`insert into configuracao_taxas (grupo_id, custo_pix_taxa) values (${grupoId}, ${taxa})
    on conflict (grupo_id) do update set custo_pix_taxa = excluded.custo_pix_taxa`)
