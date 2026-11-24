// Credencial do Mercado Pago do grupo (#51, PR5): só o admin_geral grava, pelo Editar Grupo. O token é só de
// escrita: vai cifrado para mercadopago_config e nunca volta para a tela, o log ou a mensagem de erro (#126).
import { and, eq, ne, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { mercadopagoConfig } from '@/lib/db/schema'
import { cifrar } from '@/lib/cripto'
import { ehChaveDuplicada } from '@/lib/erro-pg'
import { somenteDigitos } from '@/lib/grupo-cnpj'
import { normalizarToken } from '@/lib/token-colado'
import { RecusaUsuario } from '@/lib/resultado-action'
import { credencialRecusada, ErroMercadoPago } from './cliente'
import { consultarConta, type ContaMp } from './point'
import { FRASES_MP } from './frases'

export type PedidoCredencialMp = { mpToken?: unknown; mpRemover?: unknown }
export type DependenciasCredencialMp = {
  consultarConta: (token: string) => Promise<ContaMp>
  contaDaMensalidade: () => Promise<string | null>
  producao: boolean
}
export type PlanoCredencialMp =
  | { acao: 'manter' }
  | { acao: 'remover' }
  | { acao: 'gravar'; token: string; userId: string; titularDocumento: string | null; aviso: string | null }


// Access Token do MP: um bloco só de caracteres visíveis, depois de normalizado (decisão do Luis, #126). O que
// ainda ficar fora do formato não chega ao Mercado Pago.
const FORMATO_TOKEN = /^[\x21-\x7e]{20,300}$/

// Só o status ou o nome do erro: a mensagem pode trazer o token.
const pistaDoErro = (e: unknown) =>
  e instanceof ErroMercadoPago ? `HTTP ${e.status}` : e instanceof Error ? e.name : 'erro'

/**
 * O que fazer com a credencial do grupo, conferida no Mercado Pago antes de gravar: campo vazio mantém,
 * remover vence, token novo só passa com a conta conferida no /users/me. Não grava nada (ver aplicarCredencialMp).
 */
export async function conferirCredencialMp(
  pedido: PedidoCredencialMp, cnpjDoGrupo: string, deps: DependenciasCredencialMp,
): Promise<{ ok: true; plano: PlanoCredencialMp } | { ok: false; erro: string }> {
  if (pedido.mpRemover === true) return { ok: true, plano: { acao: 'remover' } }
  const token = normalizarToken(pedido.mpToken)
  if (!token) return { ok: true, plano: { acao: 'manter' } }
  if (!FORMATO_TOKEN.test(token)) return { ok: false, erro: FRASES_MP.formato }

  let conta: ContaMp
  try {
    conta = await deps.consultarConta(token)
  } catch (e) {
    console.error('[credencial-mp] /users/me falhou:', pistaDoErro(e))
    const recusado = credencialRecusada(e)
    return { ok: false, erro: recusado ? FRASES_MP.recusado : FRASES_MP.indisponivel }
  }
  if (deps.producao && conta.tags.includes('test_user')) return { ok: false, erro: FRASES_MP.teste }
  // Sem conferir a conta da mensalidade, o token não passa: com o MP instável (#51), aceitar calado deixaria
  // entrar a conta do MOVA.
  let mensalidade: string | null
  try {
    mensalidade = await deps.contaDaMensalidade()
  } catch (e) {
    console.error('[credencial-mp] conta da mensalidade falhou:', pistaDoErro(e))
    return { ok: false, erro: FRASES_MP.indisponivel }
  }
  if (mensalidade === conta.id) return { ok: false, erro: FRASES_MP.mensalidade }

  const titularDocumento = conta.documento === null ? null : somenteDigitos(conta.documento)
  const aviso = titularDeOutroCnpj(titularDocumento, cnpjDoGrupo) ? FRASES_MP.outroCnpj : null
  return { ok: true, plano: { acao: 'gravar', token, userId: conta.id, titularDocumento, aviso } }
}

// Sem documento do Mercado Pago, não há o que comparar: sem aviso.
const titularDeOutroCnpj = (titularDocumento: string | null, cnpjDoGrupo: string) =>
  titularDocumento !== null && somenteDigitos(titularDocumento) !== somenteDigitos(cnpjDoGrupo)

/**
 * O que a lista de grupos leva da credencial: se há, o final do id da conta e se o titular é de outro CNPJ (comparado
 * na hora, então acompanha a edição do CNPJ do grupo). Nunca o token, o id inteiro nem o documento do titular.
 */
export const credencialMpParaTela = (userId: string | null, titularDocumento: string | null, cnpjDoGrupo: string) => ({
  mpConectado: userId !== null,
  mpFinal: userId === null ? null : userId.slice(-3),
  mpOutroCnpj: userId !== null && titularDeOutroCnpj(titularDocumento, cnpjDoGrupo),
})

export const DEPENDENCIAS_CREDENCIAL_MP: DependenciasCredencialMp = {
  consultarConta,
  contaDaMensalidade: async () => {
    const token = normalizarToken(process.env.MP_ACCESS_TOKEN)
    return token ? (await consultarConta(token)).id : null
  },
  producao: process.env.VERCEL_ENV === 'production',
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

// Linha que já está gravada, qualificada: no SET do ON CONFLICT o nome solto é ambíguo de ler.
const atual = (coluna: string) => sql.raw(`"mercadopago_config"."${coluna}"`)
const mesmaConta = sql`${atual('user_id')} = excluded.user_id`

/**
 * Grava o plano na transação do grupo. Conta já ligada a outro grupo, de qualquer Conta, recebe a mesma
 * frase, sem dizer qual (inclusive na corrida, pelo índice único de user_id). Token novo apaga a falha da
 * última rodada; outra conta apaga também o resumo e a hora da última importação, que eram da antiga.
 */
export async function aplicarCredencialMp(tx: Tx, grupoId: string, usuarioId: string, plano: PlanoCredencialMp): Promise<void> {
  if (plano.acao === 'manter') return
  if (plano.acao === 'remover') {
    await tx.delete(mercadopagoConfig).where(eq(mercadopagoConfig.grupoId, grupoId))
    return
  }
  const [outro] = await tx.select({ grupoId: mercadopagoConfig.grupoId }).from(mercadopagoConfig)
    .where(and(eq(mercadopagoConfig.userId, plano.userId), ne(mercadopagoConfig.grupoId, grupoId))).limit(1)
  if (outro) throw new RecusaUsuario(FRASES_MP.jaLigada)
  try {
    await tx.insert(mercadopagoConfig)
      .values({ grupoId, token: cifrar(plano.token), userId: plano.userId, titularDocumento: plano.titularDocumento, atualizadoPor: usuarioId })
      .onConflictDoUpdate({
        target: mercadopagoConfig.grupoId,
        set: {
          token: sql`excluded.token`,
          userId: sql`excluded.user_id`,
          titularDocumento: sql`excluded.titular_documento`,
          atualizadoPor: sql`excluded.atualizado_por`,
          atualizadoEm: sql`now()`,
          ultimaFalhaEm: null,
          ultimaFalhaErro: null,
          ultimaImportacaoEm: sql`case when ${mesmaConta} then ${atual('ultima_importacao_em')} end`,
          ultimoResumo: sql`case when ${mesmaConta} then ${atual('ultimo_resumo')} end`,
        },
        setWhere: eq(mercadopagoConfig.grupoId, grupoId),
      })
  } catch (e) {
    if (ehChaveDuplicada(e)) throw new RecusaUsuario(FRASES_MP.jaLigada)
    throw e
  }
}

/** Só diz se o grupo tem credencial (para o cadastro de maquininhas, #205); o token não sai daqui. */
export async function temCredencialMercadoPago(grupoId: string): Promise<boolean> {
  const [linha] = await db.select({ grupoId: mercadopagoConfig.grupoId }).from(mercadopagoConfig)
    .where(eq(mercadopagoConfig.grupoId, grupoId)).limit(1)
  return linha !== undefined
}
