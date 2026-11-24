// Certificado de bateria (#235): a regra é pura (@/lib/certificado-bateria); aqui só se lê o que ela precisa.
// Devolve ids, nunca o e-mail da fábrica da loja: ele não pode chegar ao navegador.
import { eq, inArray } from 'drizzle-orm'
import { db } from '@/lib/db'
import { contas, grupos, lojas, modelos, motos, vendas } from '@/lib/db/schema'
import { temCertificadoBateria } from '@/lib/certificado-bateria'

/** Dos ids pedidos, os das vendas que têm certificado de bateria. */
export async function vendasComCertificadoBateria(ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set()
  const linhas = await db
    .select({
      id: vendas.id, marca: modelos.marca,
      ativa: lojas.ativa, fabricaEmail: lojas.fabricaEmail, grupoAtivo: grupos.ativo, contaDesativadaEm: contas.desativadaEm,
    })
    .from(vendas)
    .innerJoin(motos, eq(vendas.motoId, motos.id))
    .innerJoin(modelos, eq(motos.modeloId, modelos.id))
    .innerJoin(lojas, eq(vendas.lojaId, lojas.id))
    .innerJoin(grupos, eq(lojas.grupoId, grupos.id))
    .innerJoin(contas, eq(grupos.contaId, contas.id))
    .where(inArray(vendas.id, ids))
  return new Set(
    linhas
      .filter(l => temCertificadoBateria({ marca: l.marca, loja: { ativa: l.ativa, fabricaEmail: l.fabricaEmail, grupoAtivo: l.grupoAtivo, contaDesativadaEm: l.contaDesativadaEm } }))
      .map(l => l.id),
  )
}
