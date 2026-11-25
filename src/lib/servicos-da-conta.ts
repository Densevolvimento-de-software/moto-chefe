import { asc, eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { servicosCatalogo } from '@/lib/db/schema'

export function podeGerirServicos(usuario: { papel: string; grupoLiberado?: string | null }): boolean {
  return ['admin_geral', 'admin_socio'].includes(usuario.papel) && !usuario.grupoLiberado
}

export function listarServicosDaConta(contaId: string) {
  return db.select().from(servicosCatalogo).where(eq(servicosCatalogo.contaId, contaId)).orderBy(asc(servicosCatalogo.nome))
}
