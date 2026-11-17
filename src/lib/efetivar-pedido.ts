import { and, eq, inArray } from 'drizzle-orm'
import type { db } from '@/lib/db'
import { clientes, historicoEstoque, lancamentosCaixa, motos, pedidosVenda, pedidosVendaItens, reservas, vendas } from '@/lib/db/schema'
import { hojeBrt } from '@/lib/data-venda'
import { lancamentosDinheiroDaVenda } from '@/lib/caixa-venda-moto'
import { conferirMaquininhas } from '@/lib/maquininhas'
import { formaPagamentoDaVenda, pagamentosFecham, pagamentosIncompletos, PAGAMENTO_INCOMPLETO, projetarPagamentos, SOMA_PAGAMENTOS_DIFERE, type PagamentoEntrada } from '@/lib/pagamentos-entrada'
import { clientesDoEscopo, contaDaLoja } from '@/lib/conta'
import { RecusaUsuario } from '@/lib/resultado-action'
import { gravarMotoDoPedido, motosDoPedidoTx, travarMotos } from '@/lib/pedido-venda'
import { ITENS_DO_PEDIDO_MUDARAM, totalDasPecas, totalDoPedido, valoresDaEfetivacao, vendaDoPagamento, type MotoComValor } from '@/lib/pedido-venda-regras'
import { aplicarVendaPeca, FORMA_PAGAMENTO_DO_PEDIDO } from '@/lib/venda-peca'
import { grupoEmissorDaVenda } from '@/lib/notagateway/grupo-emissor'
import { lerDocumentoCliente } from '@/lib/documento'
import { freteDaVenda, PEDIDO_EM_APROVACAO_PARA_ALTERAR, totalComFrete, type EntregaVenda } from '@/lib/notagateway/entrega'
import { motivoBloqueioPedidoAprovacao, motivoParaNaoVender } from '@/lib/estado-moto'
import { gravarPedidoDeAprovacaoTx, pedidoEmAprovacaoSql } from '@/lib/pedido-de-aprovacao'
import type { TipoAprovacaoVenda } from '@/lib/aprovacao-venda'

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

export type DadosEfetivarPedido = {
  pedidoId: string
  /** Loja do pedido conferida pela action (permissão e origem). A gravação usa a loja lida do pedido sob a trava. */
  lojaId: string
  efetivadoPor: string
  clienteId: string | null
  clienteNome: string
  clienteCpf: string
  /** Valor de cada moto (#20; número no pedido de 1 moto); o frete cobrado vem do pedido e se soma aqui (#726). */
  valor: number | MotoComValor[]
  /** Pagamento do pedido inteiro (#775): as formas somam moto + frete. */
  pagamentos: PagamentoEntrada[]
  origem: { origemId: string; origemDetalhe: string | null }
  /** Persona do admin_rede (#517): só cliente do grupo liberado. */
  grupoLiberado: string | null
  /** Vindo da aprovação do pedido (#776): a moto está "aguardando aprovação" por causa dele mesmo. */
  daAprovacao?: boolean
}

/** O que o pedido em aprovação guarda em `dados_venda` para a aprovação efetivar depois (#776). */
export type PedidoEmAprovacao = Omit<DadosEfetivarPedido, 'efetivadoPor' | 'daAprovacao'> & {
  numero: number
  /** Frete cobrado, guardado junto: o líquido do snapshot é sem ele (decisão do Luis, #776). */
  frete: number
}

/** Trava o pedido pendente e todas as motos dele, em ordem de id como a troca de motos (#20). */
async function travarPedidoEMotos(tx: Tx, pedidoId: string, daAprovacao: boolean) {
  const [pedido] = await tx
    .select({
      motoId: pedidosVenda.motoId, lojaId: pedidosVenda.lojaId, vendedorId: pedidosVenda.vendedorId, status: pedidosVenda.status, entrega: pedidosVenda.entrega,
      emAprovacao: pedidoEmAprovacaoSql(pedidoId),
    })
    .from(pedidosVenda)
    .where(eq(pedidosVenda.id, pedidoId))
    .for('update')
  if (!pedido) throw new RecusaUsuario('Pedido não encontrado')
  if (pedido.status !== 'pendente') {
    throw new RecusaUsuario('Este pedido não está mais pendente. Recarregue a página.')
  }

  const motoIds = await motosDoPedidoTx(tx, pedidoId, pedido.motoId)
  const travadas = await travarMotos(tx, motoIds)
  for (const moto of motoIds.map(id => travadas.get(id))) {
    if (!moto) throw new RecusaUsuario('Moto não encontrada')
    if (moto.status === 'vendida') throw new RecusaUsuario('Moto já foi vendida')
    if (!daAprovacao && moto.disponibilidade === 'aguardando_aprovacao') throw new RecusaUsuario(motivoBloqueioPedidoAprovacao(moto)!)
  }
  return { pedido, motoIds, travadas }
}

/**
 * Troca a Entrega do pedido pendente (#895); a venda nasce com ela no efetivarPedidoTx. Trava o pedido e as motos
 * como a efetivação; em aprovação, recusa: o frete já foi guardado nos dados da aprovação. Devolve a de antes, para o log.
 */
export async function alterarEntregaDoPedidoTx(tx: Tx, pedidoId: string, entrega: EntregaVenda): Promise<EntregaVenda | null> {
  // `true` deixa passar o "aguardando aprovação", recusado logo abaixo com a frase do Alterar; "vendida" continua barrando.
  // Pelo pedido, não pela moto do `moto_id`: com várias motos ela pode não estar entre as abaixo do mínimo (#20, D-D).
  const { pedido } = await travarPedidoEMotos(tx, pedidoId, true)
  if (pedido.emAprovacao) throw new RecusaUsuario(PEDIDO_EM_APROVACAO_PARA_ALTERAR)
  await tx.update(pedidosVenda).set({ entrega, dataAtualizacao: new Date() }).where(eq(pedidosVenda.id, pedidoId))
  return pedido.entrega
}

/** Contato e endereço do cliente escolhido, lidos do cadastro da Conta; vazio sem cliente. */
async function clienteDoCadastro(tx: Tx, lojaId: string, d: Pick<DadosEfetivarPedido, 'clienteId' | 'grupoLiberado'>) {
  // Contato e endereço saem do cadastro, não do navegador: a NF exige o endereço (#577).
  // Campo vazio no cadastro fica vazio na venda; a prévia da NF avisa o que faltar.
  if (!d.clienteId) return {}
  // Cliente de outra Conta não existe para esta venda (ADR-0018); na persona, nem o de
  // outro grupo da Conta dona (ADR-0019).
  const contaId = await contaDaLoja(lojaId, tx)
  const [cliente] = await tx.select({
    clienteCelular: clientes.celular,
    clienteEmail: clientes.email,
    clienteCep: clientes.cep,
    clienteLogradouro: clientes.endereco,
    clienteNumero: clientes.numero,
    clienteComplemento: clientes.complemento,
    clienteBairro: clientes.bairro,
    clienteCidade: clientes.cidade,
    clienteEstado: clientes.uf,
    clienteIndicadorIe: clientes.indicadorIe,
    clienteInscricaoEstadual: clientes.inscricaoEstadual,
  }).from(clientes)
    .where(and(eq(clientes.id, d.clienteId), clientesDoEscopo(contaId, { contaId, grupoLiberado: d.grupoLiberado }))).limit(1)
  if (!cliente) throw new RecusaUsuario('Cliente não encontrado')
  return cliente
}

/** Brinde e acessório do pedido (#778), com o valor gravado no item. */
export async function pecasDoPedido(exec: Pick<Tx, 'select'>, pedidoId: string) {
  return exec.select({ tipo: pedidosVendaItens.tipo, pecaId: pedidosVendaItens.pecaId, quantidade: pedidosVendaItens.quantidade, valorUnitario: pedidosVendaItens.valorUnitario })
    .from(pedidosVendaItens)
    .where(and(eq(pedidosVendaItens.pedidoVendaId, pedidoId), inArray(pedidosVendaItens.tipo, ['brinde', 'acessorio'])))
}
type PecasDoPedido = Awaited<ReturnType<typeof pecasDoPedido>>

/** Confere as formas contra o total do pedido (moto + frete + acessórios) e as maquininhas da loja; devolve o total. */
async function conferirPagamentos(tx: Tx, pedido: { lojaId: string; entrega: EntregaVenda | null }, pecas: PecasDoPedido, motos: readonly MotoComValor[], d: Pick<DadosEfetivarPedido, 'pagamentos'>) {
  const total = totalDoPedido(motos.reduce((s, m) => s + m.valor, 0), pedido.entrega, pecas)
  // Aqui e não na action: o frete que entra no total só se conhece lendo o pedido.
  if (pagamentosIncompletos(d.pagamentos)) throw new RecusaUsuario(PAGAMENTO_INCOMPLETO)
  if (!pagamentosFecham(d.pagamentos, total)) throw new RecusaUsuario(SOMA_PAGAMENTOS_DIFERE)
  await conferirMaquininhas(tx, pedido.lojaId, d.pagamentos)
  return total
}

type Pedido = Awaited<ReturnType<typeof travarPedidoEMotos>>['pedido']

/** Venda de uma moto do pedido: só a do pagamento leva frete, formas e caixa (D-A); as outras, pagas pelo pedido, sem. */
async function venderMotoDoPedidoTx(tx: Tx, d: DadosEfetivarPedido, v: {
  pedido: Pedido; doCadastro: Awaited<ReturnType<typeof clienteDoCadastro>>; moto: MotoComValor; comPagamento: boolean; frete: number; agora: Date
}): Promise<string> {
  const { pedido, moto } = v
  const [reservaAtiva] = await tx
    .select({ id: reservas.id })
    .from(reservas)
    .where(and(eq(reservas.motoId, moto.motoId), eq(reservas.status, 'ativa')))
    .limit(1)

  // A venda da moto vale moto + frete (a folha lê só a moto, #796); os pagamentos são os do pedido inteiro,
  // que com acessório ou outras motos somam mais que ela (decisão do Luis, #778 e #20; o Editar venda recusa até o #23).
  const valor = totalComFrete(moto.valor, v.comPagamento ? v.frete : 0).toFixed(2)
  const [venda] = await tx.insert(vendas).values({
    pedidoVendaId: d.pedidoId,
    motoId: moto.motoId,
    lojaId: pedido.lojaId,
    vendedorId: pedido.vendedorId,
    efetivadoPor: d.efetivadoPor,
    clienteId: d.clienteId,
    ...v.doCadastro,
    clienteNome: d.clienteNome,
    clienteCpf: d.clienteCpf,
    valor,
    formaPagamento: v.comPagamento ? formaPagamentoDaVenda(d.pagamentos) : FORMA_PAGAMENTO_DO_PEDIDO,
    pagamentos: v.comPagamento ? projetarPagamentos(d.pagamentos) : [],
    reservaId: reservaAtiva?.id ?? null,
    dataVenda: v.agora,
    origemId: d.origem.origemId,
    origemDetalhe: d.origem.origemDetalhe,
    // A Entrega vem do pedido, lido aqui sob a trava: a efetivação não a recebe do navegador.
    entrega: pedido.entrega,
  }).returning({ id: vendas.id })
  // O item moto guarda só a moto: o frete mora só na Entrega e soma no total da venda (#726, #779).
  await gravarMotoDoPedido(tx, { pedidoId: d.pedidoId, motoId: moto.motoId, valor: moto.valor.toFixed(2) })

  if (reservaAtiva) {
    await tx.update(reservas).set({ status: 'convertida' }).where(eq(reservas.id, reservaAtiva.id))
  }

  await tx.update(motos)
    .set({ status: 'vendida' as any, disponibilidade: null })
    .where(eq(motos.id, moto.motoId))

  await tx.insert(historicoEstoque).values({
    motoId: moto.motoId,
    lojaOrigemId: pedido.lojaId,
    usuarioId: d.efetivadoPor,
    tipo: 'saida',
    referenciaTipo: 'pedido_venda',
    referenciaId: d.pedidoId,
    observacao: `Venda (pedido efetivado) — Cliente: ${d.clienteNome} — Total: R$ ${valor}`,
  })

  const caixa = v.comPagamento ? lancamentosDinheiroDaVenda(d.pagamentos, {
    lojaId: pedido.lojaId, usuarioId: d.efetivadoPor, vendaId: venda.id, descricao: `Venda dinheiro — ${d.clienteNome}`, data: hojeBrt(),
  }) : []
  if (caixa.length > 0) await tx.insert(lancamentosCaixa).values(caixa)
  return venda.id
}

/**
 * Efetiva um pedido de venda pendente: cria a venda, fecha o pedido, marca a moto
 * como vendida e converte a reserva ativa. Substitui a rpc efetivar_venda (0050),
 * que exige app.encryption_key (não existe em nenhum banco) e gravaria nome e CPF
 * cifrados, enquanto o resto do sistema lê texto puro (#181).
 */
export async function efetivarPedidoTx(tx: Tx, d: DadosEfetivarPedido): Promise<{ vendaId: string }> {
  const { pedido, motoIds, travadas } = await travarPedidoEMotos(tx, d.pedidoId, !!d.daAprovacao)
  const lista = valoresDaEfetivacao(motoIds, d.valor)
  if (!lista) throw new RecusaUsuario(ITENS_DO_PEDIDO_MUDARAM)
  // O status pode ter mudado depois do pedido (Editar moto); confere cada moto travada antes de vender qualquer uma.
  const naoVende = motoIds.map(id => motivoParaNaoVender(travadas.get(id)!.status)).find(m => m != null)
  if (naoVende) throw new RecusaUsuario(naoVende)
  const doCadastro = await clienteDoCadastro(tx, pedido.lojaId, d)

  const pecas = await pecasDoPedido(tx, d.pedidoId)
  await conferirPagamentos(tx, pedido, pecas, lista, d)

  const frete = freteDaVenda(pedido.entrega)
  // Só com frete e 2+ motos importa por qual CNPJ sai a NF de cada uma (D2 do #779).
  const emissores = frete > 0 && lista.length > 1 ? await Promise.all(lista.map(m => grupoEmissorDaVenda(m.motoId, pedido.lojaId, tx))) : []
  const doPagamento = vendaDoPagamento(emissores.map(e => ({ outroCnpj: !!e?.outroCnpj })), frete)
  const agora = new Date()
  // Uma venda por moto, todas ou nenhuma (#20), uma por vez: a 1ª herda o número do pedido, as outras a sequência (0193).
  const vendaIds: string[] = []
  for (const [i, moto] of lista.entries()) {
    vendaIds.push(await venderMotoDoPedidoTx(tx, d, { pedido, doCadastro, moto, comPagamento: i === doPagamento, frete, agora }))
  }

  await tx.update(pedidosVenda)
    .set({ status: 'efetivado', dataAtualizacao: agora })
    .where(eq(pedidosVenda.id, d.pedidoId))

  // Brinde e acessório viram a venda de peça do pedido (#778): baixa o estoque (pode ficar negativo), entra na
  // base de peças da folha e aparece em Peças; sem pagamento nem caixa próprios, que estão na venda da moto.
  if (pecas.length > 0) {
    const comprador = lerDocumentoCliente(d.clienteCpf)
    await aplicarVendaPeca(tx, pedido.vendedorId, {
      lojaId: pedido.lojaId,
      clienteNome: d.clienteNome,
      clienteTipoPessoa: comprador.ok ? comprador.tipoPessoa : 'fisica',
      clienteDocumento: comprador.ok ? comprador.documento : null,
      itens: pecas.map(p => ({ pecaId: p.pecaId!, quantidade: Number(p.quantidade), valorUnitario: Number(p.valorUnitario ?? 0) })),
      pagamentos: [],
    }, { pedidoVendaId: d.pedidoId, valorTotal: totalDasPecas(pecas) })
  }

  return { vendaId: vendaIds[doPagamento] }
}

/**
 * Manda o pedido para aprovação (#776): as mesmas conferências da efetivação, sem criar a venda.
 * O pedido continua pendente e a moto fica "aguardando aprovação"; aprovado, a aprovação chama o
 * efetivarPedidoTx com os dados guardados; recusado, a moto volta a reservada.
 */
export async function pedirAprovacaoDoPedidoTx(tx: Tx, d: DadosEfetivarPedido & {
  numero: number
  tipo: TipoAprovacaoVenda
  motivo: string
  /** Motos abaixo do próprio mínimo, com o mínimo e o líquido rateado (D-C); vazio no pagamento sensível. */
  abaixo: readonly { motoId: string; minimo: number; liquido: number }[]
}) {
  const { pedido, motoIds, travadas } = await travarPedidoEMotos(tx, d.pedidoId, false)
  const lista = valoresDaEfetivacao(motoIds, d.valor)
  if (!lista) throw new RecusaUsuario(ITENS_DO_PEDIDO_MUDARAM)
  await clienteDoCadastro(tx, pedido.lojaId, d)
  const total = await conferirPagamentos(tx, pedido, await pecasDoPedido(tx, d.pedidoId), lista, d)
  const guardado: PedidoEmAprovacao = {
    pedidoId: d.pedidoId, numero: d.numero, lojaId: pedido.lojaId, clienteId: d.clienteId, clienteNome: d.clienteNome,
    clienteCpf: d.clienteCpf, valor: d.valor, frete: freteDaVenda(pedido.entrega), pagamentos: projetarPagamentos(d.pagamentos),
    origem: d.origem, grupoLiberado: d.grupoLiberado,
  }
  // D-D (#20): uma linha por moto abaixo do mínimo, com o snapshot dela; o pagamento sensível é uma linha, na moto do pedido.
  const linhas = d.tipo === 'valor_minimo'
    ? d.abaixo.map(a => ({ motoId: a.motoId, snapshot: { valorMinimo: a.minimo, liquido: a.liquido } }))
    : [{ motoId: pedido.motoId, snapshot: null }]
  for (const l of linhas) {
    const moto = lista.find(m => m.motoId === l.motoId)
    if (!moto) throw new RecusaUsuario(ITENS_DO_PEDIDO_MUDARAM)
    await gravarPedidoDeAprovacaoTx(tx, {
      origem: 'pedido', moto: { id: moto.motoId, lojaId: pedido.lojaId, disponibilidade: travadas.get(moto.motoId)!.disponibilidade },
      // Valor da moto, sem o frete (#796): desconto, quadro do #878 e relatório seguem sobre a moto; o frete fica em dados_venda.
      vendedorId: pedido.vendedorId, solicitadoPor: d.efetivadoPor, valor: moto.valor.toFixed(2), dadosVenda: guardado,
      tipo: d.tipo, motivo: d.motivo, snapshot: l.snapshot,
      observacao: `Pedido #${d.numero} em aprovação — Cliente: ${d.clienteNome} — Total: R$ ${total.toFixed(2)} — Motivo: ${d.motivo}`,
    })
  }
}
