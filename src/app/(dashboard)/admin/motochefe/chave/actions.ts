'use server'
// Chave da API MotoChefe Brasil (#322). Só o admin_geral: a checagem é a 1ª linha de cada action, e nenhuma recebe
// dado da tela. A chave nova sai só no retorno, uma vez. O log leva o tipo e a quantidade, nunca a chave nem o hash.
import { revalidatePath } from 'next/cache'
import { db } from '@/lib/db'
import { exigirAdminGeral } from '@/lib/admin-geral'
import { fraseDoErroDeGerar, FRASE_ERRO_REVOGAR } from '@/lib/api-leitura'
import { registrarAcaoSensivel } from '@/lib/log-acoes'
import { ROTA_CHAVE_MOTOCHEFE } from '@/lib/motochefe-marcacao'
import { gerarOuTrocarChave, revogarChaves } from '@/lib/queries/api-leitura'
import { acao, RecusaUsuario, type ResultadoAction } from '@/lib/resultado-action'

// Só a frase: a mensagem do erro pode trazer a consulta com os parâmetros.
const FRASE_DE_LOG_GERAR = 'chave da API: gerar ou trocar não gravou'
const FRASE_DE_LOG_REVOGAR = 'chave da API: revogar não gravou'
const FRASE_DE_LOG_REVALIDAR = 'chave da API: revalidar a tela falhou (a gravação já saiu)'

// A gravação já saiu. Se revalidar falhar, a resposta segue com a chave: lançar aqui faria a tela perder a chave, que só aparece uma vez.
function revalidarTela(): void {
  try {
    revalidatePath(ROTA_CHAVE_MOTOCHEFE)
  } catch {
    console.error(FRASE_DE_LOG_REVALIDAR)
  }
}

export async function gerarOuTrocarChaveAction(): Promise<ResultadoAction<{ chave: string }>> {
  return acao(async () => {
    const admin = await exigirAdminGeral()
    let troca: Awaited<ReturnType<typeof gerarOuTrocarChave>>
    try {
      troca = await db.transaction(async tx => {
        const nova = await gerarOuTrocarChave({ geradaPor: admin.id, agora: new Date() }, tx)
        await registrarAcaoSensivel({ tipo: nova.tipo, usuarioId: admin.id, detalhe: {} }, tx)
        return nova
      })
    } catch (erro) {
      console.error(FRASE_DE_LOG_GERAR)
      throw new RecusaUsuario(fraseDoErroDeGerar(erro))
    }
    revalidarTela()
    return { chave: troca.chave }
  })
}

export async function revogarChaveAction(): Promise<ResultadoAction> {
  return acao(async () => {
    const admin = await exigirAdminGeral()
    try {
      await db.transaction(async tx => {
        const quantas = await revogarChaves(new Date(), tx)
        if (quantas > 0) {
          await registrarAcaoSensivel({ tipo: 'api_chave_revogada', usuarioId: admin.id, detalhe: { revogadas: quantas } }, tx)
        }
      })
    } catch {
      console.error(FRASE_DE_LOG_REVOGAR)
      throw new RecusaUsuario(FRASE_ERRO_REVOGAR)
    }
    revalidarTela()
  })
}
