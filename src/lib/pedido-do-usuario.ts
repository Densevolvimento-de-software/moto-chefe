import { and, asc, eq, inArray } from 'drizzle-orm'
import { db } from '@/lib/db'
import { lojas, modelos, motos, pecasCatalogo, pedidosVenda, pedidosVendaItens } from '@/lib/db/schema'
import { podeAbrirRegistroDaLoja } from '@/lib/acesso-registro'
import { lojasDoEscopo } from '@/lib/conta'
import { motosDoPedido } from '@/lib/pedido-venda-regras'
import type { MotoNoPedido } from '@/lib/novo-pedido'

type Executor = Pick<typeof db, 'select'>

/** Brinde ou acessório gravado no pedido, como a tela mostra (#25); `valor` é o de cada unidade. */
export type PecaDoPedidoNaTela = { tipo: 'brinde' | 'acessorio'; pecaId: string; nome: string; quantidade: number; valor: string }

/**
 * Pedido de venda que o usuário pode ver, ou null. A Conta entra no where; o grupo da
 * loja do pedido vem depois, no podeAbrirRegistroDaLoja. Pedido de outra Conta volta
 * null, igual a pedido inexistente: quem chama responde "Pedido não encontrado" nos
 * dois casos, para a frase não revelar que ele existe em outra Conta (#404).
 */
export async function pedidoDoUsuario(
  usuario: Parameters<typeof podeAbrirRegistroDaLoja>[0],
  pedidoId: string,
  exec: Executor = db,
) {
  const daConta = usuario.papel === 'admin_geral' ? undefined
    : usuario.contaId ? inArray(pedidosVenda.lojaId, lojasDoEscopo(usuario)) : null
  if (daConta === null) return null
  const [pedido] = await exec
    .select({ lojaId: pedidosVenda.lojaId, status: pedidosVenda.status, motoId: pedidosVenda.motoId, numero: pedidosVenda.numero, entrega: pedidosVenda.entrega })
    .from(pedidosVenda)
    .where(and(eq(pedidosVenda.id, pedidoId), daConta))
    .limit(1)
  if (!pedido || !(await podeAbrirRegistroDaLoja(usuario, pedido.lojaId, exec))) return null
  return pedido
}

/**
 * Itens do pedido (#774) com o que a tela mostra (#25), ou null quando o pedido não é visível para o usuário: a Conta é a do
 * pedido, conferida no pedidoDoUsuario, então outra Conta e id inexistente dão o mesmo null. Motos no formato do Novo pedido,
 * na ordem do `motosDoPedido` (o pedido de antes do #774 só tem a do `moto_id`, sem linha de item: entra sem valor). A loja é
 * a do pedido: o mínimo de cada moto se lê nela, como no efetivar.
 */
export async function itensDoPedido(
  usuario: Parameters<typeof podeAbrirRegistroDaLoja>[0],
  pedidoId: string,
  exec: Executor = db,
): Promise<{ lojaId: string; motos: MotoNoPedido[]; pecas: PecaDoPedidoNaTela[] } | null> {
  const pedido = await pedidoDoUsuario(usuario, pedidoId, exec)
  if (!pedido) return null
  const itens = await exec
    .select({
      tipo: pedidosVendaItens.tipo,
      motoId: pedidosVendaItens.motoId,
      pecaId: pedidosVendaItens.pecaId,
      nome: pecasCatalogo.nome,
      quantidade: pedidosVendaItens.quantidade,
      valorUnitario: pedidosVendaItens.valorUnitario,
    })
    .from(pedidosVendaItens)
    .leftJoin(pecasCatalogo, eq(pecasCatalogo.id, pedidosVendaItens.pecaId))
    .where(eq(pedidosVendaItens.pedidoVendaId, pedidoId))
    .orderBy(asc(pedidosVendaItens.criadoEm), asc(pedidosVendaItens.id))
  const motoIds = motosDoPedido(pedido.motoId, itens)
  const fichas = await exec
    .select({ id: motos.id, chassi: motos.chassi, marca: modelos.marca, modelo: modelos.modelo, cor: motos.cor, lojaId: motos.lojaId, lojaNome: lojas.nome })
    .from(motos)
    .innerJoin(modelos, eq(modelos.id, motos.modeloId))
    .innerJoin(lojas, eq(lojas.id, motos.lojaId))
    .where(inArray(motos.id, motoIds))
  return {
    lojaId: pedido.lojaId,
    motos: motoIds.flatMap(id => fichas.filter(f => f.id === id).map(f => ({
      ...f, valor: itens.find(i => i.motoId === id)?.valorUnitario ?? '',
    }))),
    pecas: itens.flatMap(i => (i.tipo !== 'moto' && i.pecaId
      ? [{ tipo: i.tipo, pecaId: i.pecaId, nome: i.nome ?? '', quantidade: Number(i.quantidade), valor: i.valorUnitario ?? '0.00' }]
      : [])),
  }
}
