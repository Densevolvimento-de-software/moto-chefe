import { and, eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { usuarios } from '@/lib/db/schema'
import { contaDaLoja } from '@/lib/conta'
import { usuarioDoEscopo } from '@/lib/usuarios-do-grupo'

type Executor = Pick<typeof db, 'select'>

/**
 * O vendedor escolhido no payload é da Conta da loja da moto (ou do grupo liberado, na persona)?
 * Sem isso, um vendedorId forjado ligava a venda a usuário de outra Conta (#404, #133).
 */
export async function vendedorDaConta(vendedorId: string, lojaIdDaMoto: string, grupoLiberado: string | null, exec: Executor = db): Promise<boolean> {
  const contaId = await contaDaLoja(lojaIdDaMoto, exec)
  const [u] = await exec
    .select({ id: usuarios.id })
    .from(usuarios)
    .where(and(eq(usuarios.id, vendedorId), usuarioDoEscopo({ contaId, grupoLiberado })))
    .limit(1)
  return !!u
}
