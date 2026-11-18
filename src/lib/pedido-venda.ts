import { and, asc, count, eq, inArray, sql } from 'drizzle-orm'
import type { db } from '@/lib/db'
import { historicoEstoque, motos, pecasCatalogo, pedidosVenda, pedidosVendaItens, reservas, transferencias, vendas } from '@/lib/db/schema'
import {
  motivoBloqueioMotoNoPedido, motosDoPedido, PEDIDO_SEM_MOTO, pecasComPrecoMantido, podeCancelarPedido, trocaDeMotos, valorDaMotoNoPedido, valorDaPecaNoPedido, valorDePecaInvalido,
  type MotoDoPedidoInput, type PecaDoPedidoInput, type QuemCancela,
} from '@/lib/pedido-venda-regras'
import { daContaDaLoja } from '@/lib/pecas-da-conta'
import { recusaDaQuantidadeVendida } from '@/lib/quantidade-vendida'
import { ehUuid } from '@/lib/uuid'
import { RecusaUsuario } from '@/lib/resultado-action'
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
  if (pecas.some(p => !['brinde', 'acessorio'].includes(p.tipo) || p.quantidade <= 0 || valorDePecaInvalido(p.valorUnitario))) {
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

/** Motos do pedido (#20): a do `moto_id` primeiro, depois as dos itens (as gravadas juntas não têm ordem entre si). */
export async function motosDoPedidoTx(exec: Pick<Tx, 'select'>, pedidoId: string, motoIdDoPedido: string): Promise<string[]> {
  const itens = await exec.select({ motoId: pedidosVendaItens.motoId }).from(pedidosVendaItens)
    .where(and(eq(pedidosVendaItens.pedidoVendaId, pedidoId), eq(pedidosVendaItens.tipo, 'moto')))
    .orderBy(asc(pedidosVendaItens.criadoEm), asc(pedidosVendaItens.id))
  return motosDoPedido(motoIdDoPedido, itens)
}

/**
 * Trava as motos numa consulta só, em ordem de id: dois pedidos que mexem em motos em comum esperam um pelo
 * outro em vez de se travarem em cruz. Quem chama já conferiu a Conta de cada uma.
 */
export async function travarMotos(tx: Tx, ids: readonly string[]) {
  const travadas = await tx
    .select({ id: motos.id, lojaId: motos.lojaId, status: motos.status, disponibilidade: motos.disponibilidade, arquivadaEm: motos.arquivadaEm })
    .from(motos).where(inArray(motos.id, [...ids])).orderBy(asc(motos.id)).for('update')
  return new Map(travadas.map(m => [m.id, m]))
}
type MotosTravadas = Awaited<ReturnType<typeof travarMotos>>

/**
 * Confere, nas motos já travadas, que cada uma das `ids` pode entrar no pedido da loja (Q14, status,
 * disponibilidade, transferência). Pedido novo: a loja é a da 1ª moto. Devolve a loja.
 */
async function conferirMotosQueEntram(tx: Tx, travadas: MotosTravadas, ids: readonly string[], lojaDoPedido?: string): Promise<string> {
  const lojaId = lojaDoPedido ?? travadas.get(ids[0])?.lojaId ?? ''
  const comTransferencia = new Set((await tx.select({ motoId: transferencias.motoId }).from(transferencias)
    .where(and(inArray(transferencias.motoId, [...ids]), eq(transferencias.status, 'pendente')))).map(t => t.motoId))
  const motivo = ids.map(id => motivoBloqueioMotoNoPedido(travadas.get(id), lojaId, comTransferencia.has(id))).find(m => m !== null)
  if (motivo) throw new RecusaUsuario(motivo)
  return lojaId
}

/** Uma linha de histórico por moto, ligada ao pedido. */
const historicoDoPedido = (d: { pedidoId: string; motoIds: readonly string[]; usuarioId: string; observacao: string }) =>
  d.motoIds.map(motoId => ({
    motoId, usuarioId: d.usuarioId, tipo: 'mudanca_status' as const, referenciaTipo: 'pedido_venda' as const, referenciaId: d.pedidoId, observacao: d.observacao,
  }))

/** Reserva as motos (já conferidas) e as grava como itens do pedido, cada uma com o seu histórico. */
async function reservarMotosNoPedidoTx(tx: Tx, d: { pedidoId: string; lista: readonly MotoDoPedidoInput[]; usuarioId: string; observacao: string }) {
  const ids = d.lista.map(m => m.motoId)
  await tx.update(motos).set({ disponibilidade: 'reservada' }).where(inArray(motos.id, ids))
  // A ordem de inclusão decide quem leva frete, formas e caixa (decisão do Luis, 17/11, na #20). Um insert só dá o mesmo
  // now() a todos e o empate cairia no id; 1 µs por posição guarda a ordem sem coluna 'ordem' (evita migração).
  await tx.insert(pedidosVendaItens).values(d.lista.map((m, i) => ({
    pedidoVendaId: d.pedidoId, tipo: 'moto' as const, motoId: m.motoId, valorUnitario: valorDaMotoNoPedido(m.valor),
    criadoEm: sql`now() + ${i}::int * interval '1 microsecond'`,
  })))
  await tx.insert(historicoEstoque).values(historicoDoPedido({ ...d, motoIds: ids }))
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
  await tx.insert(historicoEstoque).values(historicoDoPedido(d))
}

/**
 * Cria um pedido de venda pendente com 1+ motos da mesma loja (#20) e as reserva. Substitui a rpc
 * criar_pedido_venda, que exigia o status antigo 'disponivel' e recusava as motos
 * montadas que a tela oferece (#181). A 1ª moto define a loja e fica no `moto_id`.
 *
 * Contrato: lê as motos só pelo id, sem Conta. Quem chama confere antes que cada moto é da
 * pessoa (motoDoUsuario); só assim a recusa de moto arquivada (#688) não revela moto de
 * outra Conta. Aqui elas são conferidas de novo sob a trava (sumida ou arquivada no meio também recusa).
 */
export async function criarPedidoTx(
  tx: Tx,
  d: { motos: MotoDoPedidoInput[]; vendedorId: string; observacao: string | null; entrega: EntregaVenda; pecas?: PecaDoPedidoInput[] },
): Promise<{ pedidoId: string; lojaId: string }> {
  const [primeira] = d.motos
  if (!primeira) throw new RecusaUsuario(PEDIDO_SEM_MOTO)
  const ids = d.motos.map(m => m.motoId)
  const lojaId = await conferirMotosQueEntram(tx, await travarMotos(tx, ids), ids)
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
const PEDIDO_EM_APROVACAO_PARA_EDITAR = 'Este pedido está aguardando aprovação. Aprove ou recuse antes de editar o pedido.'
const SEM_PERMISSAO_ALTERAR = 'Sem permissão para alterar este pedido'
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
 * pelas conferências do criar e fica reservada. A lista é a do pedido inteiro: a moto que entra sem valor fica nula
 * (D-E); a que fica sem valor mandado guarda o que tinha. Se sai a moto do `moto_id`, ele passa para a 1ª que fica. Quem chama conferiu a Conta.
 */
export async function trocarMotosDoPedidoTx(tx: Tx, d: { pedidoId: string; motos: MotoDoPedidoInput[]; usuario: QuemCancela }): Promise<void> {
  const pedido = await travarPedidoPendente(tx, d.pedidoId, d.usuario, { semPermissao: SEM_PERMISSAO_ALTERAR, emAprovacao: PEDIDO_EM_APROVACAO_PARA_TROCAR })
  await trocarMotosTravadas(tx, d, pedido)
}

/** A troca com o pedido já travado e conferido (quem pode, pendente, fora de aprovação). */
async function trocarMotosTravadas(tx: Tx, d: { pedidoId: string; motos: MotoDoPedidoInput[]; usuario: QuemCancela }, pedido: { motoId: string; lojaId: string }) {
  const troca = trocaDeMotos(await motosDoPedidoTx(tx, d.pedidoId, pedido.motoId), d.motos.map(m => m.motoId), pedido.motoId)
  if (!troca.principal) throw new RecusaUsuario(PEDIDO_SEM_MOTO)

  const travadas = await travarMotos(tx, [...troca.entram, ...troca.saem])
  if (troca.entram.length > 0) await conferirMotosQueEntram(tx, travadas, troca.entram, pedido.lojaId)
  if (troca.saem.length > 0) {
    await tx.delete(pedidosVendaItens).where(and(eq(pedidosVendaItens.pedidoVendaId, d.pedidoId), inArray(pedidosVendaItens.motoId, troca.saem)))
    await soltarMotosTx(tx, { pedidoId: d.pedidoId, motoIds: troca.saem, usuarioId: d.usuario.id, observacao: 'Moto saiu do pedido de venda' })
  }
  const entram = d.motos.filter(m => troca.entram.includes(m.motoId))
  if (entram.length > 0) {
    await reservarMotosNoPedidoTx(tx, { pedidoId: d.pedidoId, lista: entram, usuarioId: d.usuario.id, observacao: 'Moto entrou no pedido de venda — moto reservada' })
  }
  // A que fica sem valor mandado guarda o que já tinha (a do pedido de antes do #774, sem item, segue lida pelo moto_id).
  for (const m of d.motos.filter(m => !troca.entram.includes(m.motoId) && m.valor != null)) {
    await gravarMotoDoPedido(tx, { pedidoId: d.pedidoId, motoId: m.motoId, valor: valorDaMotoNoPedido(m.valor) })
  }
  await tx.update(pedidosVenda).set({ motoId: troca.principal, dataAtualizacao: new Date() }).where(eq(pedidosVenda.id, d.pedidoId))
}

/**
 * Editar o pedido pendente (#25, 25c): motos, peças e Entrega numa transação. Quem edita é quem cancela (D-G), também a Entrega
 * (decisão 3 do Luis); em aprovação recusa. As peças são trocadas inteiras: quem não ajusta preço mantém o valor que o item já tinha
 * (decisão 4), peça nova vai pelo catálogo. A Entrega já vem conferida por quem chama.
 */
export async function salvarPedidoPendenteTx(tx: Tx, d: {
  pedidoId: string; motos: MotoDoPedidoInput[]; pecas: PecaDoPedidoInput[]; entrega: EntregaVenda; usuario: QuemCancela; podeAjustarPreco: boolean
}): Promise<void> {
  const pedido = await travarPedidoPendente(tx, d.pedidoId, d.usuario, { semPermissao: SEM_PERMISSAO_ALTERAR, emAprovacao: PEDIDO_EM_APROVACAO_PARA_EDITAR })
  await trocarMotosTravadas(tx, d, pedido)
  const daPeca = and(eq(pedidosVendaItens.pedidoVendaId, d.pedidoId), inArray(pedidosVendaItens.tipo, ['brinde', 'acessorio']))
  const atuais = await tx.select({ tipo: pedidosVendaItens.tipo, pecaId: pedidosVendaItens.pecaId, valorUnitario: pedidosVendaItens.valorUnitario })
    .from(pedidosVendaItens).where(daPeca)
  const pecas = await pecasConferidas(tx, pedido.lojaId, d.podeAjustarPreco ? d.pecas : pecasComPrecoMantido(atuais, d.pecas))
  await tx.delete(pedidosVendaItens).where(daPeca)
  if (pecas.length > 0) await tx.insert(pedidosVendaItens).values(pecas.map(p => ({ ...p, pedidoVendaId: d.pedidoId })))
  await tx.update(pedidosVenda).set({ entrega: d.entrega, dataAtualizacao: new Date() }).where(eq(pedidosVenda.id, d.pedidoId))
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

/** A venda é de um pedido efetivado com várias motos (#20): cancelar e editar são do pedido inteiro, no #23. */
export async function vendaDePedidoComVariasMotos(exec: Pick<Tx, 'select'>, pedidoVendaId: string): Promise<boolean> {
  const [{ n }] = await exec.select({ n: count() }).from(vendas).where(eq(vendas.pedidoVendaId, pedidoVendaId))
  return n > 1
}
