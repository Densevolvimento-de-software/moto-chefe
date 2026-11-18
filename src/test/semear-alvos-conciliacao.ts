import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { idDoInsert, type Executor } from '@/test/semear-conta'

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

export const semearModelo = (tx: Executor, rotulo: string) =>
  idDoInsert(tx, sql`insert into modelos (marca, modelo, categoria, potencia_w, motor, velocidade_max)
    values ('M', ${rotulo}, 'autopropelido', '1000', 'hub', '32') returning id`)

export async function semearVendaMoto(tx: Executor, b: Balcao, pagamentos: Pagamentos) {
  const moto = await idDoInsert(tx, sql`insert into motos (chassi, modelo_id, loja_id, cor, nota_fiscal_entrada, status, disponibilidade)
    values (${randomUUID()}, ${b.modeloId}, ${b.lojaId}, 'CINZA', '1', 'vendida', 'vendida') returning id`)
  const pedido = await idDoInsert(tx, sql`insert into pedidos_venda (moto_id, loja_id, vendedor_id) values (${moto}, ${b.lojaId}, ${b.usuarioId}) returning id`)
  return idDoInsert(tx, sql`insert into vendas (pedido_venda_id, moto_id, loja_id, vendedor_id, efetivado_por, cliente_nome, cliente_cpf, valor, forma_pagamento, pagamentos, data_venda)
    values (${pedido}, ${moto}, ${b.lojaId}, ${b.usuarioId}, ${b.usuarioId}, 'Cliente sintético', '52998224725', ${totalDe(pagamentos)}, ${formaDe(pagamentos)},
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
