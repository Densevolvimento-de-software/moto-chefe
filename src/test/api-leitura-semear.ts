// Semente comum dos testes de banco da API de leitura (#315): chave, Conta e loja. Tirada dos testes de vendas
// (#323) e de metas (#326). Cada arquivo guarda os próprios ids para apagar no after.
import { createHash, randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { semearContaBase, semearLoja, type Base, type Executor } from '@/test/semear-conta'

export async function semearChaveDaApi(tx: Executor, token: string, { validaAte }: { validaAte?: Date } = {}) {
  const hash = createHash('sha256').update(token).digest('hex')
  const ate = validaAte ?? new Date(Date.now() + 365 * 24 * 60 * 60 * 1000)
  const linha = await tx.execute(sql`insert into api_chaves (hash, gerada_por, valida_ate) values (${hash}, ${randomUUID()}, ${ate.toISOString()}) returning id`)
  return { hash, id: (linha as { rows: { id: string }[] }).rows[0].id }
}

export async function semearContaDaApi(
  tx: Executor,
  { prefixo, cnpj, autorizada = false, desativada = false, grupoInativo = false }:
  { prefixo: string; cnpj: string; autorizada?: boolean; desativada?: boolean; grupoInativo?: boolean },
): Promise<Base> {
  const base = await semearContaBase(tx, { prefixo, nome: `Conta ${prefixo} ${randomUUID()}`, cnpj })
  await tx.execute(sql`update contas set autoriza_custo_despesa_meta = ${autorizada}, desativada_em = ${desativada ? sql`now()` : null} where id = ${base.contaId}`)
  if (grupoInativo) await tx.execute(sql`update grupos set ativo = false where id = ${base.grupoId}`)
  return base
}

export async function semearLojaDaApi(tx: Executor, grupoId: string, nome: string, { marcada = false, emailFabrica = null }: { marcada?: boolean; emailFabrica?: string | null } = {}) {
  const id = await semearLoja(tx, grupoId, nome)
  await tx.execute(sql`update lojas set loja_motochefe = ${marcada}, fabrica_email = ${emailFabrica} where id = ${id}`)
  return id
}
