// Credencial do Mercado Pago do grupo (#51, PR5): só o admin_geral grava, pelo Editar Grupo. O token é só de
// escrita: vai cifrado para mercadopago_config e nunca volta para a tela, o log ou a mensagem de erro (#126).
import { ErroMercadoPago } from './cliente'
import type { ContaMp } from './point'

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

// Access Token do MP: um bloco só de caracteres visíveis. Espaço ou quebra de linha no meio faz o fetch lançar
// TypeError com o header inteiro (o token) na mensagem (#126); por isso nem chega a chamar.
const FORMATO_TOKEN = /^[\x21-\x7e]{20,300}$/
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
  const token = typeof pedido.mpToken === 'string' ? pedido.mpToken.trim() : ''
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
