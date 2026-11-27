// Consultas da API de leitura da MotoChefe Brasil (#315, ADR-0021). Lê várias Contas de propósito, sem sessão:
// o filtro de loja fica dentro da consulta, e a lista de colunas sai da regra pura em @/lib/api-leitura.
import { randomBytes } from 'node:crypto'
import { and, eq, isNull } from 'drizzle-orm'
import { db } from '@/lib/db'
import { apiChaves, contas, grupos, lojas } from '@/lib/db/schema'
import { sha256 } from '@/lib/assinatura/hash'
import { iguaisEmTempoConstante } from '@/lib/tempo-constante'
import { chaveAceita, linhaDaLoja, planoDaTroca, type LojaDaApi, type PlanoDaTroca } from '@/lib/api-leitura'

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]
type Executor = Pick<typeof db, 'select' | 'insert' | 'update'> | Tx

const chavesNaoRevogadas = (executor: Executor) => executor
  .select({ id: apiChaves.id, hash: apiChaves.hash, validaAte: apiChaves.validaAte, revogadaEm: apiChaves.revogadaEm })
  .from(apiChaves)
  .where(isNull(apiChaves.revogadaEm))

/**
 * O token confere com alguma chave não revogada e vigente. Compara o hash com todas, em tempo constante,
 * antes de decidir (sem parar na primeira que bate).
 */
export async function chaveConfere(token: string | null, agora: Date, executor: Executor = db): Promise<boolean> {
  if (token === null) return false
  const recebido = sha256(token)
  const abertas = await chavesNaoRevogadas(executor)
  return abertas.filter(c => iguaisEmTempoConstante(recebido, c.hash)).some(c => chaveAceita(c, agora))
}

async function aplicarPlano(plano: PlanoDaTroca, agora: Date, tx: Tx) {
  for (const id of plano.revogar) {
    await tx.update(apiChaves).set({ revogadaEm: agora }).where(eq(apiChaves.id, id))
  }
  for (const { id, validaAte } of plano.expirar) {
    await tx.update(apiChaves).set({ validaAte }).where(eq(apiChaves.id, id))
  }
}

async function trocarNaTransacao(tx: Tx, { geradaPor, agora }: { geradaPor: string; agora: Date }): Promise<string> {
  const plano = planoDaTroca(await chavesNaoRevogadas(tx).for('update'), agora)
  await aplicarPlano(plano, agora, tx)
  const chave = randomBytes(32).toString('base64url')
  await tx.insert(apiChaves).values({ hash: sha256(chave), geradaPor, geradaEm: agora })
  return chave
}

/**
 * Gera uma chave nova e devolve o texto dela uma única vez: no banco fica só o hash. A atual vira carência
 * de 24h e a que já estava em carência sai na hora (ver planoDaTroca). Quem chama informa quem gerou.
 */
export function trocarChave(opcoes: { geradaPor: string; agora: Date }, executor?: Tx): Promise<string> {
  return executor
    ? trocarNaTransacao(executor, opcoes)
    : db.transaction(tx => trocarNaTransacao(tx, opcoes))
}

/** Lojas marcadas pelo admin_geral, de Contas e grupos ativos. Inativa continua aparecendo, com ativa falso. */
export async function listarLojasDaApi(): Promise<LojaDaApi[]> {
  const linhas = await db
    .select({ id: lojas.id, nome: lojas.nome, cidade: lojas.cidade, endereco: lojas.endereco, cep: lojas.cep, ativa: lojas.ativa })
    .from(lojas)
    .innerJoin(grupos, eq(lojas.grupoId, grupos.id))
    .innerJoin(contas, eq(grupos.contaId, contas.id))
    .where(and(eq(lojas.lojaMotochefe, true), eq(grupos.ativo, true), isNull(contas.desativadaEm)))
    .orderBy(lojas.nome, lojas.id)
  return linhas.map(linhaDaLoja)
}
