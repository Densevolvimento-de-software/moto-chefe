import { and, eq, inArray } from 'drizzle-orm'
import { db } from '@/lib/db'
import { holerites, usuarios } from '@/lib/db/schema'
import { lojasDoGrupo, nomesDeUsuariosVisiveis } from '@/lib/conta'

type Executor = Pick<typeof db, 'select' | 'delete'>

// Leituras de holerite pelo id, com o grupo ativo DENTRO da consulta: registro de
// outro grupo nem é lido. Sem next/headers nem Storage, para rodar contra o banco.
// Quem chama decide a frase de recusa, a mesma para inexistente e para outro grupo.

/** Caminho no bucket de um envio novo, montado do grupo no servidor. Os antigos (sem o grupo) seguem
 *  pelo `arquivo_path` gravado: abrir e remover nunca remontam o caminho. */
export function caminhoDoHolerite(
  { grupoId, mes, usuarioId, tipo }: { grupoId: string; mes: string; usuarioId: string; tipo: string },
  sufixo: string,
) {
  return `${grupoId}/${mes}/${usuarioId}-${tipo}-${sufixo}.pdf`
}

/** Funcionário do grupo, ou null. */
export async function funcionarioDoGrupo(grupoId: string, usuarioId: string, exec: Executor = db) {
  const [alvo] = await exec
    .select({ lojaId: usuarios.lojaId, nome: usuarios.nome })
    .from(usuarios)
    .where(and(eq(usuarios.id, usuarioId), inArray(usuarios.lojaId, lojasDoGrupo(grupoId))))
    .limit(1)
  return alvo ?? null
}

/** Caminho do arquivo do holerite do grupo, ou null. */
export async function holeriteDoGrupo(grupoId: string, id: string, exec: Executor = db) {
  const [row] = await exec
    .select({ arquivoPath: holerites.arquivoPath })
    .from(holerites)
    .innerJoin(usuarios, eq(holerites.usuarioId, usuarios.id))
    .where(and(eq(holerites.id, id), inArray(usuarios.lojaId, lojasDoGrupo(grupoId))))
    .limit(1)
  return row ?? null
}

/** Apaga a linha do holerite do grupo e devolve o caminho do arquivo; null se não é do grupo. */
export async function removerHoleriteDoGrupo(grupoId: string, id: string, exec: Executor = db) {
  const [row] = await exec
    .delete(holerites)
    .where(and(
      eq(holerites.id, id),
      inArray(holerites.usuarioId, exec.select({ id: usuarios.id }).from(usuarios)
        .where(inArray(usuarios.lojaId, lojasDoGrupo(grupoId)))),
    ))
    .returning({ arquivoPath: holerites.arquivoPath })
  return row?.arquivoPath ?? null
}

/** Holerites do mês dos funcionários do grupo, com o nome de quem enviou. O nome só vem de quem a
 *  Conta do grupo enxerga (nomesDeUsuariosVisiveis): quem enviou pode estar em outro grupo da Conta. */
export async function listarHoleritesDoGrupo(grupo: { id: string; contaId: string }, mes: string, exec: Executor = db) {
  const grupoId = grupo.id
  const rows = await exec
    .select({
      id: holerites.id,
      usuarioId: holerites.usuarioId,
      mes: holerites.mes,
      tipo: holerites.tipo,
      arquivoNome: holerites.arquivoNome,
      tamanho: holerites.tamanho,
      enviadoEm: holerites.enviadoEm,
      enviadoPorId: holerites.enviadoPor,
    })
    .from(holerites)
    .innerJoin(usuarios, eq(holerites.usuarioId, usuarios.id))
    .where(and(eq(holerites.mes, mes), inArray(usuarios.lojaId, lojasDoGrupo(grupoId))))

  const nomePorId = await nomesDeUsuariosVisiveis(grupo, rows.flatMap(r => r.enviadoPorId ? [r.enviadoPorId] : []), exec)

  return rows.map(({ enviadoPorId, ...r }) => ({
    ...r,
    enviadoPorNome: enviadoPorId ? (nomePorId.get(enviadoPorId) ?? null) : null,
  }))
}
