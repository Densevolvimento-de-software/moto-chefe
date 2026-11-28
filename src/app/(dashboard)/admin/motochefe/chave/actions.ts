'use server'
// Chave da API MotoChefe Brasil (#322). Só o admin_geral: a checagem é a 1ª linha de cada action, e nenhuma recebe
// dado da tela. A chave nova sai só no retorno, uma vez. O log leva o tipo e a quantidade, nunca a chave nem o hash.
// Gerar e trocar são ações separadas: cada uma recusa com frase fixa quando o estado não é o dela.
import { revalidatePath } from 'next/cache'
import { db } from '@/lib/db'
import { exigirAdminGeral } from '@/lib/admin-geral'
import {
  fraseDoErroDaChave, FRASE_ERRO_GERAR, FRASE_ERRO_REVOGAR, FRASE_ERRO_TROCAR, FRASE_JA_TEM_CHAVE, FRASE_SEM_CHAVE,
} from '@/lib/api-leitura'
import { registrarAcaoSensivel } from '@/lib/log-acoes'
import { ROTA_CHAVE_MOTOCHEFE } from '@/lib/motochefe-marcacao'
import { gerarChave, revogarChaves, trocarChaveAtual, type ResultadoDaChave } from '@/lib/queries/api-leitura'
import { acao, RecusaUsuario, type ResultadoAction } from '@/lib/resultado-action'

// Só a frase: a mensagem do erro pode trazer a consulta com os parâmetros.
const FRASE_DE_LOG_GERAR = 'chave da API: gerar não gravou'
const FRASE_DE_LOG_TROCAR = 'chave da API: trocar não gravou'
const FRASE_DE_LOG_REVOGAR = 'chave da API: revogar não gravou'
const FRASE_DE_LOG_REVALIDAR = 'chave da API: revalidar a tela falhou (a gravação já saiu)'

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]
type Dados = { chave: string }

// A gravação já saiu. Se revalidar falhar, a resposta segue com a chave: lançar aqui faria a tela perder a chave, que só aparece uma vez.
function revalidarTela(): void {
  try {
    revalidatePath(ROTA_CHAVE_MOTOCHEFE)
  } catch {
    console.error(FRASE_DE_LOG_REVALIDAR)
  }
}

// A operação e o log na mesma transação. Recusa de pré-condição não grava nada e não registra.
function gravarComLog(
  adminId: string,
  tipo: 'api_chave_gerada' | 'api_chave_trocada',
  operacao: (tx: Tx) => Promise<ResultadoDaChave>,
): Promise<ResultadoDaChave> {
  return db.transaction(async tx => {
    const resultado = await operacao(tx)
    if (resultado.ok) await registrarAcaoSensivel({ tipo, usuarioId: adminId, detalhe: {} }, tx)
    return resultado
  })
}

// Erro do banco vira a frase da ação (a corrida tem a sua); a recusa de pré-condição vira a frase dela.
async function chaveOuRecusa(
  fraseDeLog: string,
  fraseGenerica: string,
  gravar: () => Promise<ResultadoDaChave>,
): Promise<Dados> {
  let resultado: ResultadoDaChave
  try {
    resultado = await gravar()
  } catch (erro) {
    console.error(fraseDeLog)
    throw new RecusaUsuario(fraseDoErroDaChave(erro, fraseGenerica))
  }
  if (!resultado.ok) {
    throw new RecusaUsuario(resultado.recusa === 'ja_tem_chave' ? FRASE_JA_TEM_CHAVE : FRASE_SEM_CHAVE)
  }
  return { chave: resultado.chave }
}

export async function gerarChaveAction(): Promise<ResultadoAction<Dados>> {
  return acao(async () => {
    const admin = await exigirAdminGeral()
    const dados = await chaveOuRecusa(FRASE_DE_LOG_GERAR, FRASE_ERRO_GERAR, () =>
      gravarComLog(admin.id, 'api_chave_gerada', tx => gerarChave({ geradaPor: admin.id, agora: new Date() }, tx)))
    revalidarTela()
    return dados
  })
}

export async function trocarChaveAction(): Promise<ResultadoAction<Dados>> {
  return acao(async () => {
    const admin = await exigirAdminGeral()
    const dados = await chaveOuRecusa(FRASE_DE_LOG_TROCAR, FRASE_ERRO_TROCAR, () =>
      gravarComLog(admin.id, 'api_chave_trocada', tx => trocarChaveAtual({ geradaPor: admin.id, agora: new Date() }, tx)))
    revalidarTela()
    return dados
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
