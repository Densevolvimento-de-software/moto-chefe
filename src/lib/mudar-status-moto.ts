import { sql } from 'drizzle-orm'
import { db } from '@/lib/db'

/**
 * Muda o status da moto e grava o histórico pela função do banco, na conexão do app.
 * Quem chama confere antes se o usuário pode mudar o status desta moto. `exec` é a transação
 * de quem já travou a moto e conferiu o status nela.
 */
export async function mudarStatusMoto(
  dados: { motoId: string; novoStatus: string; usuarioId: string; observacao: string | null },
  exec: Pick<typeof db, 'execute'> = db,
) {
  await exec.execute(sql`select mudar_status_moto(${dados.motoId}::uuid, ${dados.novoStatus}::moto_status,
    ${dados.usuarioId}::uuid, ${dados.observacao}::text)`)
}
