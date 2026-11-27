// Consultas da API de leitura da MotoChefe Brasil (#315, ADR-0021). Lê várias Contas de propósito, sem sessão:
// o filtro de loja fica dentro da consulta, e a lista de colunas sai da regra pura em @/lib/api-leitura.
import { randomBytes } from 'node:crypto'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { db } from '@/lib/db'
import { apiChaves, contas, grupos, lojas } from '@/lib/db/schema'
import { sha256 } from '@/lib/assinatura/hash'
import { iguaisEmTempoConstante } from '@/lib/tempo-constante'
import { chaveAceita, corpoDoErro, linhaDaLoja, planoDaTroca, statusDoErro, tokenDoBearer, type CodigoErroApi, type LojaDaApi, type PlanoDaTroca } from '@/lib/api-leitura'

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]
type Executor = Pick<typeof db, 'select' | 'insert' | 'update'> | Tx

const chavesNaoRevogadas = (executor: Executor) => executor
  .select({ id: apiChaves.id, hash: apiChaves.hash, validaAte: apiChaves.validaAte, revogadaEm: apiChaves.revogadaEm })
  .from(apiChaves)
  .where(isNull(apiChaves.revogadaEm))

// Sem token, compara com um valor fixo de mesmo tamanho que nunca é hash de chave: o caminho é o mesmo.
const HASH_SEM_TOKEN = '0'.repeat(64)

/**
 * Id da chave que o token confere e ainda vale, ou nulo. Compara o hash com todas, em tempo constante,
 * antes de decidir. O 320 usa o id para o limite e o registro.
 */
export async function buscarChaveAceita(token: string | null, agora: Date, executor: Executor = db): Promise<{ id: string } | null> {
  const recebido = token === null ? HASH_SEM_TOKEN : sha256(token)
  const abertas = await chavesNaoRevogadas(executor)
  const achada = abertas.filter(c => iguaisEmTempoConstante(recebido, c.hash)).find(c => chaveAceita(c, agora))
  return achada ? { id: achada.id } : null
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

/**
 * Ids das lojas que saem na API: marcadas pelo admin_geral, de grupo ativo e Conta não desativada.
 * Quem lê dado de loja (vendas, OS, pessoas) filtra com `inArray(coluna, lojasQueSaem())`, sem copiar a regra.
 */
export const lojasQueSaem = () => db
  .select({ id: lojas.id })
  .from(lojas)
  .innerJoin(grupos, eq(lojas.grupoId, grupos.id))
  .innerJoin(contas, eq(grupos.contaId, contas.id))
  .where(and(eq(lojas.lojaMotochefe, true), eq(grupos.ativo, true), isNull(contas.desativadaEm)))

/** Lojas que saem na API. Inativa continua aparecendo, com ativa falso. */
export async function listarLojasDaApi(): Promise<LojaDaApi[]> {
  const linhas = await db
    .select({ id: lojas.id, nome: lojas.nome, cidade: lojas.cidade, endereco: lojas.endereco, cep: lojas.cep, ativa: lojas.ativa })
    .from(lojas)
    .where(inArray(lojas.id, lojasQueSaem()))
    .orderBy(lojas.nome, lojas.id)
  return linhas.map(linhaDaLoja)
}

export type RespostaDaApi = { status: number; corpo: unknown }

const respostaDeErro = (codigo: CodigoErroApi): RespostaDaApi => ({ status: statusDoErro(codigo), corpo: corpoDoErro(codigo) })

/**
 * Casca de toda rota da API: confere a chave e chama o miolo. Sem chave, chave errada, revogada ou vencida,
 * a mesma resposta 401. Falha no miolo vira 500 com a frase fixa, sem a mensagem do erro.
 */
export async function comChaveDaApi<T>(
  authorization: string | null,
  miolo: (chave: { id: string }) => Promise<T>,
): Promise<RespostaDaApi> {
  try {
    const chave = await buscarChaveAceita(tokenDoBearer(authorization), new Date())
    if (chave === null) return respostaDeErro('acesso_negado')
    return { status: 200, corpo: await miolo(chave) }
  } catch {
    return respostaDeErro('erro_interno')
  }
}
