import { and, eq, inArray } from 'drizzle-orm'
import { db } from '@/lib/db'
import { motos } from '@/lib/db/schema'
import { podeAgirNaLoja, podeVenderMotoDaLoja } from '@/lib/acesso-registro'
import { lojasDoEscopo } from '@/lib/conta'
import { RecusaUsuario } from '@/lib/resultado-action'
import { MOTO_ARQUIVADA } from '@/lib/arquivar-moto-regras'

type Executor = Pick<typeof db, 'select'>
// Só dentro de transação: fora dela o FOR UPDATE soltaria a moto logo depois da leitura.
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

/** Conta no where: undefined = admin_geral (todas), null = sem Conta (nenhuma). */
export const daContaDo = (usuario: { papel: string; contaId: string | null; grupoLiberado?: string | null }) =>
  usuario.papel === 'admin_geral' ? undefined
    : usuario.contaId ? inArray(motos.lojaId, lojasDoEscopo(usuario)) : null

/**
 * Motos que o usuário pode vender, reservar ou pedir venda, numa consulta só (pedido com várias motos, #20), na
 * ordem pedida; ou null se alguma não existe, é de outra Conta ou de loja onde ele não vende. A Conta entra no
 * where; a regra de loja (com a exceção do Galpão) vem depois, no podeVenderMotoDaLoja. Os três casos voltam
 * null: quem chama responde "Moto não encontrada" para todos (#404). Moto arquivada da Conta recusa com a frase
 * que manda desarquivar (#688), só depois do acesso: senão a frase revelaria a moto de outra Conta.
 */
export async function motosDoUsuario(
  usuario: Parameters<typeof podeVenderMotoDaLoja>[0],
  motoIds: readonly string[],
  exec: Executor = db,
) {
  const daConta = daContaDo(usuario)
  if (daConta === null) return null
  const achadas = motoIds.length === 0 ? [] : await exec.select().from(motos).where(and(inArray(motos.id, [...motoIds]), daConta))
  const porId = new Map(achadas.map(m => [m.id, m]))
  const pedidas = motoIds.flatMap(id => porId.get(id) ?? [])
  if (pedidas.length !== motoIds.length) return null
  const lojas = [...new Set(pedidas.map(m => m.lojaId))]
  if (!(await Promise.all(lojas.map(l => podeVenderMotoDaLoja(usuario, l, exec)))).every(Boolean)) return null
  if (pedidas.some(m => m.arquivadaEm)) throw new RecusaUsuario(MOTO_ARQUIVADA)
  return pedidas
}

/** A moto que o usuário pode vender, reservar ou pedir venda, ou null: a mesma regra de `motosDoUsuario`. */
export async function motoDoUsuario(
  usuario: Parameters<typeof podeVenderMotoDaLoja>[0],
  motoId: string,
  exec: Executor = db,
) {
  return (await motosDoUsuario(usuario, [motoId], exec))?.[0] ?? null
}

/**
 * Trava a moto até o commit e recusa a arquivada (#688). Quem grava venda, reserva, pedido,
 * aprovação, transferência ou garantia chama isto dentro da transação, antes de gravar: a
 * conferência feita antes da transação não segura um arquivar que termine no meio. Lê só
 * pelo id; quem chama já conferiu a Conta (motoDoUsuario, lojaDaMotoParaGravar).
 */
export async function travarMotoNaoArquivada(tx: Tx, motoId: string) {
  const [moto] = await tx
    .select({ lojaId: motos.lojaId, status: motos.status, disponibilidade: motos.disponibilidade, arquivadaEm: motos.arquivadaEm })
    .from(motos)
    .where(eq(motos.id, motoId))
    .for('update')
  if (!moto) throw new RecusaUsuario('Moto não encontrada')
  if (moto.arquivadaEm) throw new RecusaUsuario(MOTO_ARQUIVADA)
  return moto
}

/**
 * Loja e status da moto que a ação vai gravar (transferência, garantia), ou null se não
 * existe, é de outra Conta ou a pessoa não age na loja dela. A recusa de arquivada vem só
 * depois do acesso: senão a frase revelaria a moto de outra Conta (#688).
 */
export async function lojaDaMotoParaGravar(
  usuario: Parameters<typeof podeAgirNaLoja>[0],
  motoId: string,
  exec: Executor = db,
): Promise<{ lojaId: string; status: typeof motos.$inferSelect.status } | null> {
  const daConta = daContaDo(usuario)
  if (daConta === null) return null
  const [moto] = await exec.select({ lojaId: motos.lojaId, status: motos.status, arquivadaEm: motos.arquivadaEm })
    .from(motos).where(and(eq(motos.id, motoId), daConta)).limit(1)
  if (!moto || !(await podeAgirNaLoja(usuario, moto.lojaId, exec))) return null
  if (moto.arquivadaEm) throw new RecusaUsuario(MOTO_ARQUIVADA)
  return { lojaId: moto.lojaId, status: moto.status }
}
