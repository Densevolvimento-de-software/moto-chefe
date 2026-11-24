// A opção "aux_adm pode forçar conciliação" (#220), lida do grupo. Quem chama passa a loja do registro
// (venda, peça, OS) ou o grupo da linha/PIX: a Conta do registro decide, não o grupo ativo da sessão.
import { eq } from 'drizzle-orm'
import { db } from './db'
import { grupos, lojas } from './db/schema'
import { fraseDeCompletaForcada, podeForcarConciliacao } from './conciliacao-papeis'

/** Quem manda aqui é o grupo da loja do registro: a loja vem do alvo já conferido no grupo ativo. */
export async function auxAdmPodeForcarDaLoja(lojaId: string, exec: Pick<typeof db, 'select'> = db): Promise<boolean> {
  const [linha] = await exec.select({ opcao: grupos.auxAdmPodeForcarConciliacao }).from(lojas)
    .innerJoin(grupos, eq(grupos.id, lojas.grupoId))
    .where(eq(lojas.id, lojaId)).limit(1)
  return linha?.opcao ?? false
}

/** Para linha de cartão e PIX, que já são do grupo (a coluna grupo_id do próprio registro). */
export async function auxAdmPodeForcarDoGrupo(grupoId: string): Promise<boolean> {
  const [linha] = await db.select({ opcao: grupos.auxAdmPodeForcarConciliacao }).from(grupos)
    .where(eq(grupos.id, grupoId)).limit(1)
  return linha?.opcao ?? false
}

/** Pode forçar e desfazer no grupo: papel mais a opção do grupo (o aux_adm depende dela). */
export async function podeForcarNoGrupo(papel: string, grupoId: string): Promise<boolean> {
  return podeForcarConciliacao(papel, await auxAdmPodeForcarDoGrupo(grupoId))
}

/** Frase do desvincular de um PIX que completa forçada: quem não pode desfazer recebe a de pedir ao gestor. */
export async function fraseCompletaForcadaDoGrupo(papel: string, grupoId: string): Promise<string> {
  return fraseDeCompletaForcada(await podeForcarNoGrupo(papel, grupoId))
}
