import { and, asc, eq } from 'drizzle-orm'
import { contaDaLojaNaColuna } from '@/lib/conta'
import { db } from '@/lib/db'
import { servicosCatalogo } from '@/lib/db/schema'

export function listarServicosDaConta(contaId: string) {
  return db.select().from(servicosCatalogo).where(eq(servicosCatalogo.contaId, contaId)).orderBy(asc(servicosCatalogo.nome))
}

export function listarServicosDaLoja(lojaId: string) {
  return db.select().from(servicosCatalogo).where(and(contaDaLojaNaColuna(servicosCatalogo.contaId, lojaId), eq(servicosCatalogo.ativo, true))).orderBy(asc(servicosCatalogo.nome))
}

export async function servicoUsavelNaLoja(lojaId: string, servicoId: string) {
  const [servico] = await db.select({ id: servicosCatalogo.id }).from(servicosCatalogo)
    .where(and(contaDaLojaNaColuna(servicosCatalogo.contaId, lojaId), eq(servicosCatalogo.id, servicoId), eq(servicosCatalogo.ativo, true))).limit(1)
  return !!servico
}
