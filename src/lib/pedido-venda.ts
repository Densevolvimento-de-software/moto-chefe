import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import type { db } from '@/lib/db'
import { historicoEstoque, motos, pecasCatalogo, pedidosVenda, pedidosVendaItens, reservas, transferencias } from '@/lib/db/schema'
import {
  motivoBloqueioMotoNoPedido, motosDoPedido, PEDIDO_SEM_MOTO, podeCancelarPedido, trocaDeMotos, valorDaMotoNoPedido, valorDaPecaNoPedido,
  type MotoDoPedidoInput, type PecaDoPedidoInput, type QuemCancela,
} from '@/lib/pedido-venda-regras'
import { daContaDaLoja } from '@/lib/pecas-da-conta'
import { recusaDaQuantidadeVendida } from '@/lib/quantidade-vendida'
import { ehUuid } from '@/lib/uuid'
import { RecusaUsuario } from '@/lib/resultado-action'
import { travarMotoNaoArquivada } from '@/lib/moto-do-usuario'
import { pedidoEmAprovacaoSql } from '@/lib/pedido-de-aprovacao'
import type { EntregaVenda } from '@/lib/notagateway/entrega'

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

/**
 * Brinde e acessório do pedido (#778) conferidos como na venda de peça: só peça do catálogo da Conta da loja
 * ("Peça não encontrada" também para id inexistente) e quantidade inteira. O estoque só baixa na efetivação.
 */
async function pecasConferidas(tx: Tx, lojaId: string, pecas: PecaDoPedidoInput[]) {
  if (pecas.length === 0) return []
  const recusa = recusaDaQuantidadeVendida(pecas)
  if (recusa) throw new RecusaUsuario(recusa)
  const valorInvalido = (v: number | undefined) => v != null && !(Number.isFinite(v) && v >= 0)
  if (pecas.some(p => !['brinde', 'acessorio'].includes(p.tipo) || p.quantidade <= 0 || valorInvalido(p.valorUnitario))) {
    throw new RecusaUsuario('Item do pedido inválido')
  }
  // Id que nem é uuid derrubaria a consulta com erro do banco; recebe a mesma frase de peça de outra Conta.
  if (!pecas.every(p => ehUuid(p.pecaId))) throw new RecusaUsuario('Peça não encontrada')
  const doCatalogo = await tx.select({ id: pecasCatalogo.id, valor: pecasCatalogo.valor }).from(pecasCatalogo)
    .where(and(inArray(pecasCatalogo.id, pecas.map(p => p.pecaId)), daContaDaLoja(lojaId)))
  const preco = new Map(doCatalogo.map(p => [p.id, p.valor]))
  return pecas.map(p => {
    const precoDoCatalogo = preco.get(p.pecaId)
    if (precoDoCatalogo === undefined) throw new RecusaUsuario('Peça não encontrada')
    return { tipo: p.tipo, pecaId: p.pecaId, quantidade: String(p.quantidade), valorUnitario: valorDaPecaNoPedido(p, precoDoCatalogo) }
  })
}

/** Motos do pedido (#20): a do `moto_id` e as dos itens, na ordem em que entraram. */
export async function motosDoPedidoTx(exec: Pick<Tx, 'select'>, pedidoId: string, motoIdDoPedido: string): Promise<string[]> {
  const itens = await exec.select({ motoId: pedidosVendaItens.motoId }).from(pedidosVendaItens)
    .where(and(eq(pedidosVendaItens.pedidoVendaId, pedidoId), eq(pedidosVendaItens.tipo, 'moto')))
    .orderBy(asc(pedidosVendaItens.criadoEm), asc(pedidosVendaItens.id))
  return motosDoPedido(motoIdDoPedido, itens)
}

type MotoTravada = Awaited<ReturnType<typeof travarMotoNaoArquivada>>

/** Trava as motos que entram, sempre em ordem de id: dois pedidos com motos em comum não se travam em cruz. */
const travarMotosQueEntram = (tx: Tx, ids: readonly string[]) =>
  [...ids].sort().reduce<Promise<Record<string, MotoTravada>>>(
    async (travadas, id) => ({ ...(await travadas), [id]: await travarMotoNaoArquivada(tx, id) }), Promise.resolve({}))

/**
 * Confere, sob a trava, que cada moto pode entrar no pedido da loja (Q14, status, disponibilidade, transferência).
 * Pedido novo: a loja é a da 1ª moto. Devolve a loja.
 */
async function conferirMotosQueEntram(tx: Tx, ids: readonly string[], lojaDoPedido?: string): Promise<string> {
  const travadas = await travarMotosQueEntram(tx, ids)
  const lojaId = lojaDoPedido ?? travadas[ids[0]].lojaId
  const comTransferencia = new Set((await tx.select({ motoId: transferencias.motoId }).from(transferencias)
    .where(and(inArray(transferencias.motoId, [...ids]), eq(transferencias.status, 'pendente')))).map(t => t.motoId))
  const motivo = ids.map(id => motivoBloqueioMotoNoPedido(travadas[id], lojaId, comTransferencia.has(id))).find(m => m !== null)
  if (motivo) throw new RecusaUsuario(motivo)
  return lojaId
}

/** Reserva as motos (já conferidas) e as grava como itens do pedido, cada uma com o seu histórico. */
async function reservarMotosNoPedidoTx(tx: Tx, d: { pedidoId: string; lista: readonly MotoDoPedidoInput[]; usuarioId: string; observacao: string }) {
  const ids = d.lista.map(m => m.motoId)
  await tx.update(motos).set({ disponibilidade: 'reservada' }).where(inArray(motos.id, ids))
  await tx.insert(pedidosVendaItens).values(d.lista.map(m => ({
    pedidoVendaId: d.pedidoId, tipo: 'moto' as const, motoId: m.motoId, valorUnitario: valorDaMotoNoPedido(m.valor),
  })))
  await tx.insert(historicoEstoque).values(ids.map(motoId => ({
    motoId, usuarioId: d.usuarioId, tipo: 'mudanca_status' as const, referenciaTipo: 'pedido_venda' as const, referenciaId: d.pedidoId, observacao: d.observacao,
  })))
}

/**
 * Devolve as motos a 'disponivel'. Só a que ainda está reservada e sem reserva ativa: se mudou por outro
 * caminho (vendida, aguardando aprovação, reserva de verdade), não mexe nela.
 */
async function soltarMotosTx(tx: Tx, d: { pedidoId: string; motoIds: readonly string[]; usuarioId: string; observacao: string }) {
  const ids = [...d.motoIds]
  const travadas = await tx.select({ id: motos.id, disponibilidade: motos.disponibilidade }).from(motos)
    .where(inArray(motos.id, ids)).orderBy(asc(motos.id)).for('update')
  const comReserva = new Set((await tx.select({ motoId: reservas.motoId }).from(reservas)
    .where(and(inArray(reservas.motoId, ids), eq(reservas.status, 'ativa')))).map(r => r.motoId))
  const liberar = travadas.filter(m => m.disponibilidade === 'reservada' && !comReserva.has(m.id)).map(m => m.id)
  if (liberar.length > 0) await tx.update(motos).set({ disponibilidade: 'disponivel' }).where(inArray(motos.id, liberar))
  await tx.insert(historicoEstoque).values(ids.map(motoId => ({
    motoId, usuarioId: d.usuarioId, tipo: 'mudanca_status' as const, referenciaTipo: 'pedido_venda' as const, referenciaId: d.pedidoId, observacao: d.observacao,
  })))
}

/**
 * Cria um pedido de venda pendente com 1+ motos da mesma loja (#20) e as reserva. Substitui a rpc
 * criar_pedido_venda, que exigia o status antigo 'disponivel' e recusava as motos
 * montadas que a tela oferece (#181). A 1ª moto define a loja e fica no `moto_id`.
 *
 * Contrato: lê as motos só pelo id, sem Conta. Quem chama confere antes que cada moto é da
 * pessoa (motoDoUsuario); só assim a recusa de moto arquivada (#688) não revela moto de
 * outra Conta. Aqui elas são conferidas de novo sob a trava (travarMotoNaoArquivada).
 */
export async function criarPedidoTx(
  tx: Tx,
  d: { motos: MotoDoPedidoInput[]; vendedorId: string; observacao: string | null; entrega: EntregaVenda; pecas?: PecaDoPedidoInput[] },
): Promise<{ pedidoId: string; lojaId: string }> {
  const [primeira] = d.motos
  if (!primeira) throw new RecusaUsuario(PEDIDO_SEM_MOTO)
  const lojaId = await conferirMotosQueEntram(tx, d.motos.map(m => m.motoId))
  const pecas = await pecasConferidas(tx, lojaId, d.pecas ?? [])

  const [pedido] = await tx.insert(pedidosVenda).values({
    motoId: primeira.motoId,
    lojaId,
    vendedorId: d.vendedorId,
    status: 'pendente',
    observacao: d.observacao,
    entrega: d.entrega,
  }).returning({ id: pedidosVenda.id })
  await reservarMotosNoPedidoTx(tx, { pedidoId: pedido.id, lista: d.motos, usuarioId: d.vendedorId, observacao: 'Pedido de venda criado — moto reservada' })
  if (pecas.length > 0) await tx.insert(pedidosVendaItens).values(pecas.map(p => ({ ...p, pedidoVendaId: pedido.id })))

  return { pedidoId: pedido.id, lojaId }
}

/**
 * Cancela um pedido pendente e devolve as motos dele a 'disponivel'. Substitui a rpc
 * cancelar_pedido_venda, que gravava o status antigo e recusava o sócio (#181).
 */
export const PEDIDO_AGUARDANDO_APROVACAO = 'Este pedido está aguardando aprovação. Aprove ou recuse antes de cancelar.'
const PEDIDO_EM_APROVACAO_PARA_TROCAR = 'Este pedido está aguardando aprovação. Aprove ou recuse antes de trocar as motos.'
const PEDIDO_NAO_PENDENTE = 'Este pedido não está mais pendente. Recarregue a página.'

/** Trava o pedido pendente que a pessoa pode mexer (a regra do cancelar, D-G do #20) e recusa o que está em aprovação. */
async function travarPedidoPendente(tx: Tx, pedidoId: string, usuario: QuemCancela, frases: { semPermissao: string; emAprovacao: string }) {
  const [pedido] = await tx
    .select({ motoId: pedidosVenda.motoId, lojaId: pedidosVenda.lojaId, vendedorId: pedidosVenda.vendedorId, status: pedidosVenda.status })
    .from(pedidosVenda)
    .where(eq(pedidosVenda.id, pedidoId))
    .for('update')
  if (!pedido) throw new RecusaUsuario('Pedido não encontrado')
  if (pedido.status !== 'pendente') throw new RecusaUsuario(PEDIDO_NAO_PENDENTE)
  if (!podeCancelarPedido(usuario, pedido)) throw new RecusaUsuario(frases.semPermissao)
  // Mexer no meio deixaria a aprovação pendente sobre outro pedido (#776). O pedido travado segura quem pede aprovação.
  const [{ emAprovacao }] = await tx.select({ emAprovacao: pedidoEmAprovacaoSql(pedidoId) }).from(pedidosVenda).where(eq(pedidosVenda.id, pedidoId))
  if (emAprovacao) throw new RecusaUsuario(frases.emAprovacao)
  return pedido
}

export async function cancelarPedidoTx(
  tx: Tx,
  d: { pedidoId: string; usuario: QuemCancela; observacao: string | null },
): Promise<void> {
  const pedido = await travarPedidoPendente(tx, d.pedidoId, d.usuario, { semPermissao: 'Sem permissão para cancelar este pedido', emAprovacao: PEDIDO_AGUARDANDO_APROVACAO })

  // O motivo do cancelamento vai só para o histórico: a observação de quem criou o pedido fica.
  await tx.update(pedidosVenda)
    .set({ status: 'cancelado', dataAtualizacao: new Date() })
    .where(eq(pedidosVenda.id, d.pedidoId))

  await soltarMotosTx(tx, {
    pedidoId: d.pedidoId,
    motoIds: await motosDoPedidoTx(tx, d.pedidoId, pedido.motoId),
    usuarioId: d.usuario.id,
    observacao: d.observacao ? `Pedido de venda cancelado — ${d.observacao}` : 'Pedido de venda cancelado',
  })
}

/**
 * Troca as motos do pedido pendente (#20): a que sai volta a disponível e deixa de ser item; a que entra passa
 * pelas conferências do criar e fica reservada. A lista é a do pedido inteiro: o valor de cada moto é o que veio
 * (sem valor, nulo; D-E). Se sai a moto do `moto_id`, ele passa para a 1ª que fica. Quem chama conferiu a Conta.
 */
export async function trocarMotosDoPedidoTx(tx: Tx, d: { pedidoId: string; motos: MotoDoPedidoInput[]; usuario: QuemCancela }): Promise<void> {
  const pedido = await travarPedidoPendente(tx, d.pedidoId, d.usuario, { semPermissao: 'Sem permissão para alterar este pedido', emAprovacao: PEDIDO_EM_APROVACAO_PARA_TROCAR })
  const troca = trocaDeMotos(await motosDoPedidoTx(tx, d.pedidoId, pedido.motoId), d.motos.map(m => m.motoId), pedido.motoId)
  if (!troca.principal) throw new RecusaUsuario(PEDIDO_SEM_MOTO)

  if (troca.entram.length > 0) await conferirMotosQueEntram(tx, troca.entram, pedido.lojaId)
  if (troca.saem.length > 0) {
    await tx.delete(pedidosVendaItens).where(and(eq(pedidosVendaItens.pedidoVendaId, d.pedidoId), inArray(pedidosVendaItens.motoId, troca.saem)))
    await soltarMotosTx(tx, { pedidoId: d.pedidoId, motoIds: troca.saem, usuarioId: d.usuario.id, observacao: 'Moto saiu do pedido de venda' })
  }
  const entram = d.motos.filter(m => troca.entram.includes(m.motoId))
  if (entram.length > 0) {
    await reservarMotosNoPedidoTx(tx, { pedidoId: d.pedidoId, lista: entram, usuarioId: d.usuario.id, observacao: 'Moto entrou no pedido de venda — moto reservada' })
  }
  for (const m of d.motos.filter(m => !troca.entram.includes(m.motoId))) {
    await gravarMotoDoPedido(tx, { pedidoId: d.pedidoId, motoId: m.motoId, valor: valorDaMotoNoPedido(m.valor) })
  }
  await tx.update(pedidosVenda).set({ motoId: troca.principal, dataAtualizacao: new Date() }).where(eq(pedidosVenda.id, d.pedidoId))
}

/**
 * Grava a moto como item do pedido, com o valor (nulo = ainda não informado). Se o item já
 * existe, só troca o valor: assim a efetivação preenche o item do Novo pedido e o pedido de
 * antes dos itens (#774) ganha o seu. Quem chama já conferiu na Conta o pedido (ou a venda dele). O
 * conflito (pedido, moto) só casa linha deste pedido; o setWhere repete isso por extenso, como a
 * regra de upsert do AGENTS.md pede, mas não acrescenta trava.
 */
export async function gravarMotoDoPedido(
  tx: Tx,
  d: { pedidoId: string; motoId: string; valor: string | null },
): Promise<void> {
  await tx.insert(pedidosVendaItens)
    .values({ pedidoVendaId: d.pedidoId, tipo: 'moto', motoId: d.motoId, valorUnitario: d.valor })
    .onConflictDoUpdate({
      target: [pedidosVendaItens.pedidoVendaId, pedidosVendaItens.motoId],
      targetWhere: sql`moto_id is not null`,
      set: { valorUnitario: d.valor },
      setWhere: eq(pedidosVendaItens.pedidoVendaId, d.pedidoId),
    })
}
