/**
 * Editar do pedido efetivado (#23, Q17): cliente, valor de cada moto e de cada acessório, pagamento do pedido, data, vendedor e
 * origem valem para todas as vendas do pedido e para a venda de peça dele. Pôr ou tirar item e a Entrega ficam fora (P3).
 * Com NF valendo em qualquer venda, cliente e valores não mudam; o resto, sim (P4, P5).
 */
import { and, asc, eq } from 'drizzle-orm'
import type { db } from '@/lib/db'
import { lancamentosCaixa, pedidosVenda, pedidosVendaItens, vendas, vendasPecas, vendasPecasItens } from '@/lib/db/schema'
import { lancamentosDinheiroDaVenda } from '@/lib/caixa-venda-moto'
import { conferirMaquininhas, operadorasGravadas } from '@/lib/maquininhas'
import { formaPagamentoDaVenda, pagamentosFecham, SOMA_PAGAMENTOS_DIFERE, type PagamentoEntrada } from '@/lib/pagamentos-entrada'
import { RecusaUsuario } from '@/lib/resultado-action'
import { gravarCompradorDaVenda, type CompradorConferido } from '@/lib/venda-comprador'
import { gravarMotoDoPedido } from '@/lib/pedido-venda'
import { pecasDoPedido } from '@/lib/efetivar-pedido'
import { ITENS_DO_PEDIDO_MUDARAM, totalDasPecas, totalDoPedido, valoresDaEfetivacao, type MotoComValor } from '@/lib/pedido-venda-regras'
import { algumValorMudou, clienteMudou, nfQueTravaOPedido, recusaDaEdicaoNaNota } from '@/lib/pedido-efetivado-regras'
import { FORMA_PAGAMENTO_DO_PEDIDO } from '@/lib/venda-peca'
import { freteDaVenda, totalComFrete } from '@/lib/notagateway/entrega'
import { notasParaTravaDasVendas } from '@/lib/notagateway/nf-viva'
import { podeAlterarValorVenda, VALOR_SO_DOS_ADMINISTRADORES } from '@/lib/valor-venda'
import { parseDataInput } from '@/lib/data-venda'
import { soDigitosDoc } from '@/lib/documento'

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

/** O que a action já conferiu fora da transação (comprador, origem, vendedor, forma das listas). */
export type EdicaoDoPedidoEfetivado = {
  comprador: CompradorConferido
  dataVenda: string
  vendedorId: string | null
  origem: { origemId: string; origemDetalhe: string | null } | null
  pagamentos: PagamentoEntrada[]
  motos: MotoComValor[]
  /** Valor de cada unidade de cada acessório do pedido; o brinde segue R$ 0. */
  acessorios: { pecaId: string; valor: number }[]
}

/** Os acessórios do pedido com o valor novo; null se a lista não é a do pedido. */
function acessoriosComValorNovo(pecas: Awaited<ReturnType<typeof pecasDoPedido>>, novos: EdicaoDoPedidoEfetivado['acessorios']) {
  const valor = new Map(novos.map(a => [a.pecaId, a.valor]))
  const acessorios = pecas.filter(p => p.tipo === 'acessorio')
  if (valor.size !== novos.length || valor.size !== acessorios.length || acessorios.some(a => !valor.has(a.pecaId!))) return null
  return pecas.map(p => (p.tipo === 'acessorio' ? { ...p, valorUnitario: valor.get(p.pecaId!)!.toFixed(2) } : p))
}

/**
 * As vendas do pedido, a do pagamento (D-A do #20: formas, caixa e frete; com uma venda só, é ela) e a NF que trava, lidas do mesmo
 * jeito pela tela (o aviso "Na nota") e pela gravação. `travar` pega as vendas com `for update` (só dentro de transação).
 */
export async function vendasETravaDoPedido(exec: Pick<Tx, 'select'>, pedidoVendaId: string, papel: string, travar = false) {
  const q = exec.select().from(vendas).where(eq(vendas.pedidoVendaId, pedidoVendaId)).orderBy(asc(vendas.id)).$dynamic()
  const doPedido = await (travar ? q.for('update') : q)
  const doPagamento = doPedido.find(v => v.formaPagamento !== FORMA_PAGAMENTO_DO_PEDIDO) ?? doPedido[0]
  if (!doPagamento) throw new RecusaUsuario('Venda não encontrada')
  const notas = await notasParaTravaDasVendas(exec, doPedido.map(v => v.id))
  const trava = nfQueTravaOPedido(doPedido.map(v => ({ notas: notas.filter(n => n.vendaId === v.id), notaFiscalSaida: v.notaFiscalSaida })), papel, new Date())
  return { doPedido, doPagamento, frete: freteDaVenda(doPagamento.entrega), trava }
}

export async function editarPedidoEfetivadoTx(tx: Tx, d: {
  pedidoVendaId: string; usuario: { id: string; papel: string; grupoLiberado: string | null }; edicao: EdicaoDoPedidoEfetivado
}): Promise<void> {
  const { edicao, usuario } = d
  const { doPedido, doPagamento, frete, trava } = await vendasETravaDoPedido(tx, d.pedidoVendaId, usuario.papel, true)
  const freteDa = (vendaId: string) => (vendaId === doPagamento.id ? frete : 0)

  const motos = valoresDaEfetivacao(doPedido.map(v => v.motoId), edicao.motos)
  const pecas = await pecasDoPedido(tx, d.pedidoVendaId)
  const pecasNovas = acessoriosComValorNovo(pecas, edicao.acessorios)
  if (!motos || !pecasNovas) throw new RecusaUsuario(ITENS_DO_PEDIDO_MUDARAM)

  const gravados = new Map([
    ...doPedido.map(v => [v.motoId, Number(v.valor) - freteDa(v.id)] as const),
    ...pecas.filter(p => p.tipo === 'acessorio').map(p => [p.pecaId!, Number(p.valorUnitario ?? 0)] as const),
  ])
  const valorMudou = algumValorMudou(gravados, [
    ...motos.map(m => ({ chave: m.motoId, valor: m.valor })), ...edicao.acessorios.map(a => ({ chave: a.pecaId, valor: a.valor })),
  ])
  if (valorMudou && !podeAlterarValorVenda(usuario.papel)) throw new RecusaUsuario(VALOR_SO_DOS_ADMINISTRADORES)

  const recusa = recusaDaEdicaoNaNota(trava, valorMudou || clienteMudou(doPagamento, edicao.comprador.dados))
  if (recusa) throw new RecusaUsuario(recusa)

  const total = totalDoPedido(motos.reduce((s, m) => s + m.valor, 0), doPagamento.entrega, pecasNovas)
  if (!pagamentosFecham(edicao.pagamentos, total)) throw new RecusaUsuario(SOMA_PAGAMENTOS_DIFERE)
  await conferirMaquininhas(tx, doPagamento.lojaId, edicao.pagamentos, operadorasGravadas(doPagamento.pagamentos))

  const dataVenda = parseDataInput(edicao.dataVenda)
  const comuns = { dataVenda, ...(edicao.vendedorId ? { vendedorId: edicao.vendedorId } : {}), ...(edicao.origem ?? {}) }
  for (const moto of motos) {
    const venda = doPedido.find(v => v.motoId === moto.motoId)!
    const comPagamento = venda.id === doPagamento.id
    await tx.update(vendas).set({
      ...comuns,
      valor: totalComFrete(moto.valor, freteDa(venda.id)).toFixed(2),
      ...(comPagamento ? { pagamentos: edicao.pagamentos, formaPagamento: formaPagamentoDaVenda(edicao.pagamentos) } : {}),
    }).where(eq(vendas.id, venda.id))
    await gravarMotoDoPedido(tx, { pedidoId: d.pedidoVendaId, motoId: moto.motoId, valor: moto.valor.toFixed(2) })
    await gravarCompradorDaVenda(tx, venda, usuario.grupoLiberado, edicao.comprador)
  }
  if (edicao.vendedorId) await tx.update(pedidosVenda).set({ vendedorId: edicao.vendedorId }).where(eq(pedidosVenda.id, d.pedidoVendaId))

  // O caixa do dinheiro é só da venda do pagamento: apaga e refaz, como o Editar venda.
  await tx.delete(lancamentosCaixa).where(and(eq(lancamentosCaixa.vendaId, doPagamento.id), eq(lancamentosCaixa.tipo, 'entrada')))
  const caixa = lancamentosDinheiroDaVenda(edicao.pagamentos, {
    lojaId: doPagamento.lojaId, usuarioId: usuario.id, vendaId: doPagamento.id,
    descricao: `Venda dinheiro (editado) — ${edicao.comprador.dados.clienteNome}`, data: edicao.dataVenda,
  })
  if (caixa.length > 0) await tx.insert(lancamentosCaixa).values(caixa)

  await editarVendaPecaDoPedidoTx(tx, d.pedidoVendaId, { ...comuns, comprador: edicao.comprador, pecas: pecasNovas })
}

/** A venda de peça do pedido (#778) acompanha: data, vendedor, cliente e o valor de cada acessório (a folha lê dela). */
async function editarVendaPecaDoPedidoTx(tx: Tx, pedidoVendaId: string, e: {
  dataVenda: Date; vendedorId?: string; comprador: CompradorConferido; pecas: Awaited<ReturnType<typeof pecasDoPedido>>
}) {
  const [vendaPeca] = await tx.select({ id: vendasPecas.id }).from(vendasPecas).where(eq(vendasPecas.pedidoVendaId, pedidoVendaId)).for('update')
  if (!vendaPeca) return
  await tx.update(vendasPecas).set({
    dataVenda: e.dataVenda, ...(e.vendedorId ? { vendedorId: e.vendedorId } : {}),
    clienteNome: e.comprador.dados.clienteNome, clienteDocumento: soDigitosDoc(e.comprador.comprador.clienteCpf),
    clienteTipoPessoa: e.comprador.comprador.tipoPessoa, valorTotal: totalDasPecas(e.pecas).toFixed(2),
  }).where(eq(vendasPecas.id, vendaPeca.id))
  for (const a of e.pecas.filter(p => p.tipo === 'acessorio')) {
    await tx.update(pedidosVendaItens).set({ valorUnitario: a.valorUnitario })
      .where(and(eq(pedidosVendaItens.pedidoVendaId, pedidoVendaId), eq(pedidosVendaItens.tipo, 'acessorio'), eq(pedidosVendaItens.pecaId, a.pecaId!)))
  }
  // Os itens da venda de peça nasceram dos itens do pedido (efetivarPedidoTx) e não guardam se são brinde: refeitos deles, com a
  // mesma descrição e quantidade, o estoque não muda.
  const antigos = await tx.delete(vendasPecasItens).where(eq(vendasPecasItens.vendaPecaId, vendaPeca.id))
    .returning({ pecaId: vendasPecasItens.pecaId, descricao: vendasPecasItens.descricao })
  const descricao = new Map(antigos.map(i => [i.pecaId, i.descricao]))
  if (e.pecas.length > 0) {
    await tx.insert(vendasPecasItens).values(e.pecas.map(p => ({
      vendaPecaId: vendaPeca.id, pecaId: p.pecaId!, descricao: descricao.get(p.pecaId!) ?? '', quantidade: p.quantidade, valorUnitario: p.valorUnitario ?? '0',
    })))
  }
}
