import { and, asc, eq, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { servicosCatalogo } from '@/lib/db/schema'

export function podeGerirServicos(usuario: { papel: string; grupoLiberado?: string | null }): boolean {
  return ['admin_geral', 'admin_socio'].includes(usuario.papel) && !usuario.grupoLiberado
}

export function listarServicosDaConta(contaId: string) {
  return db.select().from(servicosCatalogo).where(eq(servicosCatalogo.contaId, contaId)).orderBy(asc(servicosCatalogo.nome))
}

function contaDaLoja(lojaId: string) {
  return sql`${servicosCatalogo.contaId} = (select g.conta_id from lojas l join grupos g on g.id = l.grupo_id where l.id = ${lojaId})`
}

export function listarServicosDaLoja(lojaId: string) {
  return db.select().from(servicosCatalogo).where(and(contaDaLoja(lojaId), eq(servicosCatalogo.ativo, true))).orderBy(asc(servicosCatalogo.nome))
}

export async function servicoUsavelNaLoja(lojaId: string, servicoId: string) {
  const [servico] = await db.select({ id: servicosCatalogo.id }).from(servicosCatalogo)
    .where(and(contaDaLoja(lojaId), eq(servicosCatalogo.id, servicoId), eq(servicosCatalogo.ativo, true))).limit(1)
  return !!servico
}
