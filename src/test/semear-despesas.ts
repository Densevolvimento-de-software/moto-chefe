// Despesas, saídas do extrato (Open Finance) e lançamentos de caixa para os testes de banco.
import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { idDoInsert, type Executor } from '@/test/semear-conta'

export type DespesaSemente = {
  grupoId: string
  usuarioId: string
  categoria?: string
  lojaId?: string | null
  beneficiario?: string | null
  valor?: string
  data?: string
}

export const semearDespesa = (tx: Executor, d: DespesaSemente) =>
  idDoInsert(tx, sql`insert into despesas (grupo_id, loja_id, usuario_id, categoria, beneficiario, valor, data, forma_pagamento, banco)
    values (${d.grupoId}, ${d.lojaId ?? null}, ${d.usuarioId}, ${d.categoria ?? 'Outros'}, ${d.beneficiario ?? null},
      ${d.valor ?? '10.00'}, ${d.data ?? '2026-09-10'}, 'Pix', 'Banco') returning id`)

export type SaidaSemente = {
  grupoId: string
  categoria?: string | null
  lojaId?: string | null
  despesaId?: string | null
  lancadoPorId?: string | null
  data?: string
}

export const semearSaidaDoExtrato = (tx: Executor, s: SaidaSemente) =>
  idDoInsert(tx, sql`insert into despesas_open_finance (grupo_id, conta_id, banco, transacao_id, data, valor, categoria, loja_id, despesa_id, lancado_por_id)
    values (${s.grupoId}, 'c', 'Banco', ${randomUUID()}, ${(s.data ?? '2026-09-13') + 'T12:00:00Z'}::timestamptz, '30.00',
      ${s.categoria ?? null}, ${s.lojaId ?? null}, ${s.despesaId ?? null}, ${s.lancadoPorId ?? null}) returning id`)

export type LancamentoCaixaSemente = {
  lojaId: string
  usuarioId: string
  tipo?: 'entrada' | 'saida'
  categoria?: string
  data?: string
  aprovadoPorId?: string | null
}

export const semearLancamentoCaixa = (tx: Executor, c: LancamentoCaixaSemente) =>
  idDoInsert(tx, sql`insert into lancamentos_caixa (loja_id, usuario_id, tipo, categoria, valor, data, aprovado_por_id)
    values (${c.lojaId}, ${c.usuarioId}, ${c.tipo ?? 'saida'}, ${c.categoria ?? 'Outros'}, '10.00', ${c.data ?? '2026-09-10'},
      ${c.aprovadoPorId ?? null}) returning id`)
