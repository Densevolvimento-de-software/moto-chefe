'use server'
// Tela Lojas MotoChefe (#321). Só o admin_geral grava: a checagem é a primeira linha, e o pedido passa
// pela leitura pura antes de qualquer consulta. Não há Conta no filtro: a tela é da plataforma, de propósito.
import { revalidatePath } from 'next/cache'
import { exigirAdminGeral } from '@/lib/admin-geral'
import { acao, RecusaUsuario, type ResultadoAction } from '@/lib/resultado-action'
import {
  lerAutorizacao, lerMarcacao, MENSAGEM_CONTA_NAO_ENCONTRADA, MENSAGEM_LOJA_NAO_ENCONTRADA, ROTA_LOJAS_MOTOCHEFE,
} from '@/lib/motochefe-marcacao'
import { autorizarCustoDespesaMeta, marcarLojaMotochefe } from '@/lib/motochefe-marcacao-banco'

export async function marcarLojaMotochefeAction(entrada: unknown): Promise<ResultadoAction> {
  return acao(async () => {
    const admin = await exigirAdminGeral()
    const marcacao = lerMarcacao(entrada)
    if (!marcacao) throw new RecusaUsuario(MENSAGEM_LOJA_NAO_ENCONTRADA)
    const r = await marcarLojaMotochefe(admin.id, marcacao)
    if (!r.ok) throw new RecusaUsuario(r.erro)
    revalidatePath(ROTA_LOJAS_MOTOCHEFE)
  })
}

export async function autorizarContaAction(entrada: unknown): Promise<ResultadoAction> {
  return acao(async () => {
    const admin = await exigirAdminGeral()
    const autorizacao = lerAutorizacao(entrada)
    if (!autorizacao) throw new RecusaUsuario(MENSAGEM_CONTA_NAO_ENCONTRADA)
    const r = await autorizarCustoDespesaMeta(admin.id, autorizacao)
    if (!r.ok) throw new RecusaUsuario(r.erro)
    revalidatePath(ROTA_LOJAS_MOTOCHEFE)
  })
}
