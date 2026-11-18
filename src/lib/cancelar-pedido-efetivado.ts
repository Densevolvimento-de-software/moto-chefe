/**
 * "Cancelar venda" de uma venda de pedido (#23, Q16): cancela o pedido inteiro. Todas as vendas dele saem juntas (caixa,
 * cartão, PIX, contrato), as motos voltam ao estoque e a venda de peça do pedido (brinde e acessório, #778) é desfeita,
 * com o saldo devolvido. Venda do Vender é um pedido de uma venda: sai igual a antes.
 */
import { asc, eq, inArray } from 'drizzle-orm'
import type { db } from '@/lib/db'
import { historicoEstoque, motos, pedidosVenda, vendas, vendasPecas } from '@/lib/db/schema'
import { apagarVendaTx, somarDesvinculados, type VendaApagada } from '@/lib/apagar-venda'
import { apagarVendaPecaTx } from '@/lib/excluir-venda-peca'
import { travaDoPapel } from '@/lib/cancelar-venda'
import { vendaTemNfViva } from '@/lib/notagateway/nf-viva'

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

/** As vendas do pedido, em ordem de id (a ordem da trava). */
export function vendasDoPedidoTx(exec: Pick<Tx, 'select'>, pedidoVendaId: string) {
  return exec.select({ id: vendas.id, notaFiscalSaida: vendas.notaFiscalSaida }).from(vendas)
    .where(eq(vendas.pedidoVendaId, pedidoVendaId)).orderBy(asc(vendas.id))
}

/** O que fica no histórico da moto: o mesmo texto do cancelar de uma venda só. */
function observacaoDoCancelamento(v: { clienteNome: string; valor: string }, apagada: VendaApagada['desvinculados'], motivo: string) {
  const recebido = apagada.valor > 0
    ? ` — Recebimentos desvinculados: ${apagada.cartao} cartão + ${apagada.pix} PIX (R$ ${apagada.valor.toFixed(2)})`
    : ''
  const assinaturas = apagada.documentosAssinados > 0
    ? ` — ${apagada.documentosAssinados} documento(s) ASSINADO(S) removido(s) com a venda`
    : ''
  return `Venda cancelada — Cliente: ${v.clienteNome} — Valor: R$ ${Number(v.valor).toFixed(2)}${recebido}${assinaturas} — Motivo: ${motivo}`
}

/**
 * Quem chama já achou a venda com a Conta e conferiu papel, loja e a trava da NF fora da transação. Aqui as vendas do pedido
 * ficam travadas e a NF é conferida de novo: uma emissão na mesma hora espera e falha na chave, e a que entrou antes devolve
 * null (nada é apagado). Devolve as vendas apagadas, para o log, e o que foi solto.
 */
export async function cancelarPedidoEfetivadoTx(tx: Tx, d: { pedidoVendaId: string; usuario: { id: string; papel: string }; motivo: string }) {
  const travadas = await tx.select({
    id: vendas.id, numero: vendas.numero, motoId: vendas.motoId, lojaId: vendas.lojaId, clienteNome: vendas.clienteNome,
    valor: vendas.valor, notaFiscalSaida: vendas.notaFiscalSaida,
  }).from(vendas).where(eq(vendas.pedidoVendaId, d.pedidoVendaId)).orderBy(asc(vendas.id)).for('update')
  // Um "Confirmar NF" entre a conferência e aqui também trava o aux_adm (#191).
  if (travadas.some(v => travaDoPapel(d.usuario.papel, v.notaFiscalSaida))) return null
  for (const v of travadas) if (await vendaTemNfViva(tx, v.id)) return null

  const motoIds = travadas.map(v => v.motoId)
  if (motoIds.length > 0) await tx.update(motos).set({ status: 'montada', disponibilidade: 'disponivel' }).where(inArray(motos.id, motoIds))
  await tx.update(pedidosVenda).set({ status: 'cancelado' }).where(eq(pedidosVenda.id, d.pedidoVendaId))

  const apagadas = await travadas.reduce<Promise<VendaApagada[]>>(async (antes, v) => {
    const feitas = await antes
    const apagada = await apagarVendaTx(tx, v.id)
    await tx.insert(historicoEstoque).values({
      motoId: v.motoId, lojaDestinoId: v.lojaId, usuarioId: d.usuario.id, tipo: 'mudanca_status',
      statusAnterior: 'vendida', statusNovo: 'montada', observacao: observacaoDoCancelamento(v, apagada.desvinculados, d.motivo),
    })
    return [...feitas, apagada]
  }, Promise.resolve([]))

  const pecas = await tx.select({ id: vendasPecas.id, lojaId: vendasPecas.lojaId }).from(vendasPecas)
    .where(eq(vendasPecas.pedidoVendaId, d.pedidoVendaId)).orderBy(asc(vendasPecas.id)).for('update')
  for (const p of pecas) await apagarVendaPecaTx(tx, { vendaId: p.id, lojaId: p.lojaId, usuarioId: d.usuario.id })

  return {
    vendas: travadas.map(({ id, numero, lojaId, clienteNome, valor }) => ({ id, numero, lojaId, clienteNome, valor })),
    desvinculados: somarDesvinculados(apagadas.map(a => a.desvinculados)),
    arquivosAssinatura: apagadas.flatMap(a => a.arquivosAssinatura),
  }
}
