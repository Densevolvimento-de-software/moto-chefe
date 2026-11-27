// Consultas da API de leitura da MotoChefe Brasil (#315, ADR-0021). Lê várias Contas de propósito, sem sessão:
// o filtro de loja fica dentro da consulta, e a lista de colunas sai da regra pura em @/lib/api-leitura.
import { randomBytes } from 'node:crypto'
import { after } from 'next/server'
import { and, eq, inArray, isNull, lt, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { apiAcessos, apiChaves, apiLimite, contas, grupos, lojas } from '@/lib/db/schema'
import { sha256 } from '@/lib/assinatura/hash'
import { origemDaRequisicao } from '@/lib/log-acoes'
import { iguaisEmTempoConstante, tokenDoBearer } from '@/lib/tempo-constante'
import {
  chaveAceita, janelaDoMinuto, linhaDaLoja, linhaDoAcesso, passouDoLimite, planoDaTroca, respostaDeErro, respostaDeLimite,
  type LinhaDoAcesso, type LojaDaApi, type PlanoDaTroca, type RespostaDaApi, type ResultadoDoMiolo,
} from '@/lib/api-leitura'

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
 * antes de decidir. O id alimenta o limite e o registro.
 */
export async function buscarChaveAceita(token: string | null, agora: Date, executor: Executor = db): Promise<{ id: string } | null> {
  const recebido = token === null ? HASH_SEM_TOKEN : sha256(token)
  const abertas = await chavesNaoRevogadas(executor)
  const achada = abertas.filter(c => iguaisEmTempoConstante(recebido, c.hash)).find(c => chaveAceita(c, agora))
  return token !== null && achada ? { id: achada.id } : null
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

/**
 * Conta um pedido na janela do minuto e devolve o total dela. Um comando só: o insert cria a linha ou soma
 * 1 à que já existe, sem ler antes, para duas chamadas ao mesmo tempo não passarem do limite juntas.
 */
export async function contarPedido(chaveId: string, janela: Date): Promise<number> {
  const [linha] = await db
    .insert(apiLimite)
    .values({ chaveId, janela, pedidos: 1 })
    .onConflictDoUpdate({ target: [apiLimite.chaveId, apiLimite.janela], set: { pedidos: sql`${apiLimite.pedidos} + 1` } })
    .returning({ pedidos: apiLimite.pedidos })
  return linha.pedidos
}

// Só a frase: a mensagem do erro pode trazer a consulta com o hash da chave nos parâmetros.
const FRASE_DE_LOG_DE_ERRO = 'api de leitura: erro interno'
// Só a frase: a mensagem do banco pode trazer a linha do registro, com o IP e o pedido.
const FRASE_DE_LOG_DE_REGISTRO = 'api de leitura: registro de acesso não gravado'

async function gravarAcesso(linha: LinhaDoAcesso): Promise<void> {
  await db.insert(apiAcessos).values(linha)
}

// `after` roda depois da resposta: a gravação não atrasa a chamada, e o Next mantém a função viva até ela acabar.
function registrarDepois(linha: LinhaDoAcesso): void {
  after(async () => {
    try {
      await gravarAcesso(linha)
    } catch {
      console.error(FRASE_DE_LOG_DE_REGISTRO)
    }
  })
}

/**
 * Casca de toda rota da API. Ordem: chave, limite, miolo, registro. Sem chave, chave errada, revogada ou
 * vencida: a mesma resposta 401. Acima do limite da janela: 429 com Retry-After. Falha no miolo vira 500 com
 * a frase fixa. Toda chamada, inclusive a recusada, gera uma linha em api_acessos.
 */
export function comChaveDaApi<T extends ResultadoDoMiolo>(
  headers: Headers,
  endpoint: string,
  miolo: (chave: { id: string }) => Promise<T>,
): Promise<RespostaDaApi> {
  const agora = new Date()
  const origem = origemDaRequisicao(headers)
  const registrar = (chaveId: string | null, resposta: RespostaDaApi, extra: Partial<ResultadoDoMiolo> = {}): RespostaDaApi => {
    registrarDepois(linhaDoAcesso({
      chaveId, endpoint, status: resposta.status, origem, periodo: extra.periodo, pagina: extra.pagina, linhas: extra.linhas,
    }))
    return resposta
  }
  const erroInterno = (chaveId: string | null) => {
    console.error(FRASE_DE_LOG_DE_ERRO)
    return registrar(chaveId, respostaDeErro('erro_interno'))
  }
  const comChave = async (chave: { id: string }): Promise<RespostaDaApi> => {
    if (passouDoLimite(await contarPedido(chave.id, janelaDoMinuto(agora)))) {
      return registrar(chave.id, respostaDeLimite(agora))
    }
    const resultado = await miolo(chave)
    return registrar(chave.id, { status: 200, corpo: resultado.corpo }, resultado)
  }
  return buscarChaveAceita(tokenDoBearer(headers.get('authorization')), agora).then(
    chave => (chave === null ? registrar(null, respostaDeErro('acesso_negado')) : comChave(chave).catch(() => erroInterno(chave.id))),
    () => erroInterno(null),
  )
}

/** Registro de acesso com mais de 12 meses sai (ADR-0021). O índice de criado_em cobre o filtro. */
export async function apagarAcessosAntigos(): Promise<number> {
  const apagadas = await db.delete(apiAcessos)
    .where(lt(apiAcessos.criadoEm, sql`now() - interval '12 months'`))
    .returning({ id: apiAcessos.id })
  return apagadas.length
}

/** Janela do contador com mais de 1 dia sai: o limite só olha a janela atual. */
export async function apagarJanelasAntigas(): Promise<number> {
  const apagadas = await db.delete(apiLimite)
    .where(lt(apiLimite.janela, sql`now() - interval '1 day'`))
    .returning({ chaveId: apiLimite.chaveId })
  return apagadas.length
}
