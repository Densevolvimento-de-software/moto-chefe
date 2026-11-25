import { and, inArray } from 'drizzle-orm'
import { db } from '@/lib/db'
import { usuarios } from '@/lib/db/schema'
import { contaDaLoja } from '@/lib/conta'
import { registrarAcaoSensivelSemFalhar } from '@/lib/log-acoes'
import { usuarioDoEscopo } from '@/lib/usuarios-do-grupo'
import { houveTrocaDeVendedor } from '@/lib/valor-venda'

type Executor = NonNullable<Parameters<typeof registrarAcaoSensivelSemFalhar>[1]>

export type TrocaDeVendedor = {
  /** Quem trocou: o usuário da sessão. */
  usuarioId: string
  venda: { id: string; numero: number; lojaId: string }
  /** O vendedor gravado na venda antes da edição. */
  anterior: string
  /** O que veio no pedido; ausente = a edição não mexe no vendedor. */
  novo: string | undefined
  grupoLiberado: string | null
}

/**
 * Grava no log de ações a troca de vendedor de uma venda de moto, com o vendedor anterior e o novo,
 * na Conta e no grupo da loja da venda. Chame depois da transação: a troca já está gravada, e erro
 * no log vira só console.error.
 */
export async function registrarTrocaDeVendedor(t: TrocaDeVendedor, exec: Executor = db): Promise<void> {
  if (!houveTrocaDeVendedor(t.anterior, t.novo)) return
  // Nome só dos usuários da Conta da venda, como na conferência do vendedor (vendedorDaConta).
  let nomes = new Map<string, string>()
  try {
    const contaId = await contaDaLoja(t.venda.lojaId, exec)
    nomes = new Map((await exec.select({ id: usuarios.id, nome: usuarios.nome }).from(usuarios)
      .where(and(inArray(usuarios.id, [t.anterior, t.novo]), usuarioDoEscopo({ contaId, grupoLiberado: t.grupoLiberado }))))
      .map(u => [u.id, u.nome]))
  } catch (e) {
    console.error('[log-acoes] falha ao buscar vendedores para vendedor_venda_trocado:', e instanceof Error ? e.message : e)
  }
  await registrarAcaoSensivelSemFalhar({
    tipo: 'vendedor_venda_trocado', usuarioId: t.usuarioId, lojaId: t.venda.lojaId,
    detalhe: {
      vendaId: t.venda.id, numeroVenda: t.venda.numero,
      vendedorAnteriorId: t.anterior, vendedorAnterior: nomes.get(t.anterior) ?? null,
      vendedorId: t.novo, vendedor: nomes.get(t.novo) ?? null,
    },
  }, exec)
}
