// Rótulos dos registros a que um PIX ou uma linha de cartão está ligado (venda de moto, pedido,
// venda de peça, OS), para as telas /pix-mcp e /conciliacao mostrarem o vínculo.
import { eq, inArray, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { clientes, ordensServico, pedidosVenda, vendas, vendasPecas } from '@/lib/db/schema'

type Executor = Pick<typeof db, 'select'>
export type GrupoDoRegistro = { id: string; contaId: string }

export type IdsDoVinculoPix = { vendaIds: string[]; osIds: string[]; pedidoIds: string[]; pecaVendaIds: string[] }
export type RotulosDoVinculoPix = {
  nfDaVenda: Map<string, string | null>
  numeroDaOs: Map<string, number | null>
  numeroDoPedido: Map<string, number>
  numeroDaPeca: Map<string, number>
}

export type IdsDoAlvoCartao = { vendaIds: string[]; pecaVendaIds: string[]; osIds: string[] }
export type ResumoDoAlvo = { id: string; numero: number; clienteNome: string; valor: string }
export type ResumosDoAlvoCartao = {
  vendas: Map<string, ResumoDoAlvo>
  pecas: Map<string, ResumoDoAlvo>
  os: Map<string, ResumoDoAlvo>
}

const SEM_CLIENTE = 'Cliente não identificado'

const porId = <T extends { id: string }, V>(linhas: T[], valor: (l: T) => V) => new Map(linhas.map(l => [l.id, valor(l)]))

async function seHouver<T>(ids: string[], ler: (ids: string[]) => Promise<T[]>): Promise<T[]> {
  return ids.length > 0 ? ler([...new Set(ids)]) : []
}

export async function rotulosDoVinculoPix(_grupo: GrupoDoRegistro, ids: IdsDoVinculoPix, exec: Executor = db): Promise<RotulosDoVinculoPix> {
  const [vendasDb, osDb, pedidosDb, pecasDb] = await Promise.all([
    seHouver(ids.vendaIds, x => exec.select({ id: vendas.id, nf: vendas.notaFiscalSaida }).from(vendas)
      .where(inArray(vendas.id, x))),
    seHouver(ids.osIds, x => exec.select({ id: ordensServico.id, numero: ordensServico.numero }).from(ordensServico)
      .where(inArray(ordensServico.id, x))),
    seHouver(ids.pedidoIds, x => exec.select({ id: pedidosVenda.id, numero: pedidosVenda.numero }).from(pedidosVenda)
      .where(inArray(pedidosVenda.id, x))),
    seHouver(ids.pecaVendaIds, x => exec.select({ id: vendasPecas.id, numero: vendasPecas.numero }).from(vendasPecas)
      .where(inArray(vendasPecas.id, x))),
  ])
  return {
    nfDaVenda: porId(vendasDb, v => v.nf),
    numeroDaOs: porId(osDb, o => o.numero),
    numeroDoPedido: porId(pedidosDb, p => p.numero),
    numeroDaPeca: porId(pecasDb, p => p.numero),
  }
}

export async function resumosDoAlvoCartao(_grupo: GrupoDoRegistro, ids: IdsDoAlvoCartao, exec: Executor = db): Promise<ResumosDoAlvoCartao> {
  const [vendasDb, pecasDb, osDb] = await Promise.all([
    seHouver(ids.vendaIds, x => exec
      .select({ id: vendas.id, numero: vendas.numero, clienteNome: vendas.clienteNome, valor: vendas.valor })
      .from(vendas)
      .where(inArray(vendas.id, x))),
    seHouver(ids.pecaVendaIds, x => exec
      .select({ id: vendasPecas.id, numero: vendasPecas.numero, clienteNome: vendasPecas.clienteNome, valor: vendasPecas.valorTotal })
      .from(vendasPecas)
      .where(inArray(vendasPecas.id, x))),
    seHouver(ids.osIds, x => exec
      .select({
        id: ordensServico.id,
        numero: ordensServico.numero,
        clienteNome: sql<string>`COALESCE(${clientes.nome}, ${ordensServico.clienteNomeExterno}, ${SEM_CLIENTE})`,
        valor: ordensServico.valorTotal,
      })
      .from(ordensServico)
      .leftJoin(clientes, eq(ordensServico.clienteId, clientes.id))
      .where(inArray(ordensServico.id, x))),
  ])
  return {
    vendas: porId(vendasDb, v => v),
    pecas: porId(pecasDb, p => ({ ...p, clienteNome: p.clienteNome ?? SEM_CLIENTE })),
    os: porId(osDb, o => ({ ...o, numero: o.numero ?? 0, valor: o.valor ?? '0' })),
  }
}
