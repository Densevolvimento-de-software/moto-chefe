import { and, eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { lancamentosCaixa } from '@/lib/db/schema'
import { podeAgirNaLoja } from '@/lib/acesso-registro'
import { lojaNoEscopo } from '@/lib/conta'
import { ehUuid } from '@/lib/uuid'

type Executor = Pick<typeof db, 'select'>

/**
 * Lançamento de caixa em que o usuário pode agir, pelo id ou pelo caminho do comprovante, ou null.
 * A Conta entra no where; a regra de loja vem depois, no podeAgirNaLoja. Outra Conta (ou loja que
 * ele não opera) volta null, igual a inexistente: quem chama responde a mesma frase (#153).
 */
export async function lancamentoCaixaDoUsuario(
  usuario: Parameters<typeof podeAgirNaLoja>[0],
  alvo: { id: string } | { comprovante: string },
  exec: Executor = db,
) {
  const daConta = lojaNoEscopo(usuario, lancamentosCaixa.lojaId)
  if (daConta === null) return null
  if ('id' in alvo && !ehUuid(alvo.id)) return null
  const chave = 'id' in alvo ? eq(lancamentosCaixa.id, alvo.id) : eq(lancamentosCaixa.comprovanteUrl, alvo.comprovante)
  const [lancamento] = await exec
    .select({ id: lancamentosCaixa.id, tipo: lancamentosCaixa.tipo, status: lancamentosCaixa.statusAprovacao, lojaId: lancamentosCaixa.lojaId })
    .from(lancamentosCaixa)
    .where(and(chave, daConta))
    .limit(1)
  if (!lancamento || !(await podeAgirNaLoja(usuario, lancamento.lojaId, exec))) return null
  return lancamento
}
