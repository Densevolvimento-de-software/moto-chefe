// Credencial do Mercado Pago do grupo (#51, PR5): só o admin_geral grava, pelo Editar Grupo. O token é só de
// escrita: vai cifrado para mercadopago_config e nunca volta para a tela, o log ou a mensagem de erro (#126).
import { and, eq, ne, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { mercadopagoConfig } from '@/lib/db/schema'
import { cifrar } from '@/lib/cripto'
import { ehChaveDuplicada } from '@/lib/entrada-motos'
import { RecusaUsuario } from '@/lib/resultado-action'
import { ErroMercadoPago } from './cliente'
import { consultarConta, type ContaMp } from './point'

export type PedidoCredencialMp = { mpToken?: unknown; mpRemover?: unknown }
export type DependenciasCredencialMp = {
  consultarConta: (token: string) => Promise<ContaMp>
  contaDaMensalidade: () => Promise<string | null>
  producao: boolean
}
export type PlanoCredencialMp =
  | { acao: 'manter' }
  | { acao: 'remover' }
  | { acao: 'gravar'; token: string; userId: string; aviso: string | null }

export const FRASES_MP = {
  formato: 'Esse token não está no formato do Mercado Pago. Copie de novo, sem espaços nem quebra de linha.',
  recusado: 'O Mercado Pago recusou esse token. Confira se é o Access Token de produção da conta da loja.',
  indisponivel: 'O Mercado Pago não respondeu agora. Tente de novo em alguns minutos.',
  teste: 'Esta credencial é de uma conta de teste do Mercado Pago. Aqui só entra a credencial da conta real da loja.',
  mensalidade: 'Esse token é da conta do MOVA que cobra a mensalidade. Use o token da conta da loja.',
  jaLigada: 'Essa conta do Mercado Pago já está ligada a outro grupo.',
  outroCnpj: 'Credencial salva, mas confira: a conta do Mercado Pago é de outro CNPJ, diferente do CNPJ deste grupo.',
} as const

// Access Token do MP: um bloco só de caracteres visíveis. Espaço ou quebra de linha da cópia saem antes de qualquer
// uso (decisão do Luis, #126): no meio do header, o fetch lança TypeError com o token inteiro na mensagem. O que
// ainda ficar fora do formato não chega ao Mercado Pago.
const FORMATO_TOKEN = /^[\x21-\x7e]{20,300}$/
export const normalizarToken = (colado: unknown) => (typeof colado === 'string' ? colado.replace(/\s+/g, '') : '')
const digitos = (s: string) => s.replace(/\D/g, '')

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
    const recusado = e instanceof ErroMercadoPago && (e.status === 401 || e.status === 403)
    return { ok: false, erro: recusado ? FRASES_MP.recusado : FRASES_MP.indisponivel }
  }
  if (deps.producao && conta.tags.includes('test_user')) return { ok: false, erro: FRASES_MP.teste }
  const mensalidade = await deps.contaDaMensalidade().catch(() => null)
  if (mensalidade === conta.id) return { ok: false, erro: FRASES_MP.mensalidade }

  const outroCnpj = conta.documento !== null && digitos(conta.documento) !== digitos(cnpjDoGrupo)
  return { ok: true, plano: { acao: 'gravar', token, userId: conta.id, aviso: outroCnpj ? FRASES_MP.outroCnpj : null } }
}

/** O que a lista de grupos leva da credencial: se há e o final do id da conta, nunca o token nem o id inteiro. */
export const credencialMpParaTela = (userId: string | null) =>
  ({ mpConectado: userId !== null, mpFinal: userId === null ? null : userId.slice(-3) })

export const DEPENDENCIAS_CREDENCIAL_MP: DependenciasCredencialMp = {
  consultarConta,
  contaDaMensalidade: async () => {
    const token = process.env.MP_ACCESS_TOKEN
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
      .values({ grupoId, token: cifrar(plano.token), userId: plano.userId, atualizadoPor: usuarioId })
      .onConflictDoUpdate({
        target: mercadopagoConfig.grupoId,
        set: {
          token: sql`excluded.token`,
          userId: sql`excluded.user_id`,
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
    if (ehChaveDuplicada(e as Parameters<typeof ehChaveDuplicada>[0])) throw new RecusaUsuario(FRASES_MP.jaLigada)
    throw e
  }
}
