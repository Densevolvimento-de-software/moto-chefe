import { and, desc, eq } from 'drizzle-orm'
import type { db } from '@/lib/db'
import { motosFiscal, notasFiscaisSaida, vendas } from '@/lib/db/schema'
import { normalizarCest } from '@/lib/nfe-fiscal'
import { codigoRecusa, ehDenegada } from '@/lib/notagateway/status'
import { escolherTentativa } from '@/lib/notagateway/tentativa'
import { grupoEmissorDaVenda } from '@/lib/notagateway/grupo-emissor'
import { conferirCompradorDaVenda, gravarCompradorDaVenda, type CompradorVenda } from '@/lib/venda-comprador'
import { vendaDoUsuarioParaNf } from '@/lib/venda-do-usuario'

/**
 * Correção da nota recusada (#347): grava no cadastro de origem (comprador na
 * venda, NCM e CEST na ficha da moto) e a nota é remontada dele no reenvio.
 * Empresa e tributação não se corrigem aqui: são da configuração do grupo.
 */
export type CorrecaoNf = {
  comprador?: Pick<CompradorVenda,
    'clienteNome' | 'clienteCpf' | 'clienteCep' | 'clienteLogradouro' | 'clienteNumero' | 'clienteComplemento'
    | 'clienteBairro' | 'clienteCidade' | 'clienteEstado' | 'clienteIndicadorIe' | 'clienteInscricaoEstadual'>
  moto?: { ncm: string; cest: string }
  /** Denegada 302/303: só a IE do comprador muda; o resto do comprador fica. */
  ieComprador?: Pick<CompradorVenda, 'clienteIndicadorIe' | 'clienteInscricaoEstadual'>
}

type Executor = Pick<typeof db, 'select' | 'insert' | 'update' | 'delete'>
type Usuario = Parameters<typeof vendaDoUsuarioParaNf>[0]

export async function gravarCorrecaoDaNf(
  tx: Executor,
  usuario: Usuario,
  motoId: string,
  ambiente: 'Homologacao' | 'Producao',
  correcao: CorrecaoNf,
): Promise<void> {
  // Mesma regra da emissão e da prévia (#17): quem emite corrige. Outra Conta responde como inexistente.
  const venda = await vendaDoUsuarioParaNf(usuario, eq(vendas.motoId, motoId), tx)
  // Mesmo grupo da montagem da nota: o que comprou a moto, quando é o caso (#552).
  const emissor = venda && await grupoEmissorDaVenda(venda.motoId, venda.lojaId, tx)
  if (!venda || !emissor) throw new Error('Venda não encontrada')
  const grupoId = emissor.grupoId

  const [ultima] = await tx.select({ status: notasFiscaisSaida.status, motivoStatus: notasFiscaisSaida.motivoStatus }).from(notasFiscaisSaida)
    .where(and(eq(notasFiscaisSaida.vendaId, venda.id), eq(notasFiscaisSaida.grupoId, grupoId), eq(notasFiscaisSaida.ambiente, ambiente)))
    .orderBy(desc(notasFiscaisSaida.criadoEm)).limit(1)
  const codigo = ultima ? codigoRecusa(ultima.motivoStatus) : null
  if (ultima && ehDenegada(ultima) && (codigo === 302 || codigo === 303)) {
    // O número já ficou na SEFAZ: corrige o cadastro e a próxima nota sai com outro.
    if (correcao.comprador || correcao.moto || !correcao.ieComprador) {
      throw new Error('Nesta nota só a Inscrição Estadual do cliente se corrige aqui')
    }
    const ie = conferirCompradorDaVenda({ clienteNome: venda.clienteNome, clienteCpf: venda.clienteCpf, ...correcao.ieComprador }, venda.clienteCpf)
    if (ie.comprador.tipoPessoa !== 'juridica') throw new Error('O cliente é pessoa física: Inscrição Estadual não se aplica. Corrija o documento em Editar venda.')
    await gravarCompradorDaVenda(tx, venda, usuario.grupoLiberado ?? null, ie)
    return
  }

  const tentativa = await escolherTentativa(tx, { vendaId: venda.id, grupoId, numeroVenda: venda.numero, ambiente })
  if (!tentativa.notaId || correcao.ieComprador) throw new Error('A última nota desta venda não está recusada: não há o que corrigir')

  let ficha: { ncm: string; cest: string | null } | null = null
  if (correcao.moto) {
    const ncm = correcao.moto.ncm.replace(/\D/g, '')
    if (ncm.length !== 8) throw new Error('NCM precisa ter 8 dígitos')
    const c = normalizarCest(correcao.moto.cest)
    if (!c.ok) throw new Error(c.error)
    ficha = { ncm, cest: c.cest }
  }
  // Documento inválido barra antes de gravar qualquer coisa (ADR-0015).
  const comprador = correcao.comprador ? conferirCompradorDaVenda(correcao.comprador, venda.clienteCpf) : null

  if (comprador) await gravarCompradorDaVenda(tx, venda, usuario.grupoLiberado ?? null, comprador)
  if (ficha) {
    const atualizadas = await tx.update(motosFiscal).set(ficha)
      .where(eq(motosFiscal.motoId, venda.motoId)).returning({ id: motosFiscal.motoId })
    if (!atualizadas.length) throw new Error('Moto sem ficha fiscal')
  }
}
