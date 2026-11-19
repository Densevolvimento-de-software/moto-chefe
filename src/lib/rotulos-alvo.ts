// Rótulos dos registros a que um PIX ou uma linha de cartão está ligado (venda de moto, pedido,
// venda de peça, OS), para as telas /pix-mcp e /conciliacao mostrarem o vínculo. Só das lojas do
// grupo do PIX ou da linha, o mesmo escopo que o vínculo exige ao gravar: id de outro grupo ou de
// outra Conta sai igual a id inexistente (#128).
import { and, eq, inArray, sql } from 'drizzle-orm'
import type { AnyPgColumn } from 'drizzle-orm/pg-core'
import { db } from '@/lib/db'
import { clientes, ordensServico, pedidosVenda, vendas, vendasPecas } from '@/lib/db/schema'
import { lojasDoGrupo } from '@/lib/conta'

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

const doGrupo = (t: { id: AnyPgColumn; lojaId: AnyPgColumn }, ids: string[], grupoId: string) =>
  and(inArray(t.id, ids), inArray(t.lojaId, lojasDoGrupo(grupoId)))

async function seHouver<T>(ids: string[], ler: (ids: string[]) => Promise<T[]>): Promise<T[]> {
  return ids.length > 0 ? ler([...new Set(ids)]) : []
}

export async function rotulosDoVinculoPix(grupo: GrupoDoRegistro, ids: IdsDoVinculoPix, exec: Executor = db): Promise<RotulosDoVinculoPix> {
  const [vendasDb, osDb, pedidosDb, pecasDb] = await Promise.all([
    seHouver(ids.vendaIds, x => exec.select({ id: vendas.id, nf: vendas.notaFiscalSaida }).from(vendas)
      .where(doGrupo(vendas, x, grupo.id))),
    seHouver(ids.osIds, x => exec.select({ id: ordensServico.id, numero: ordensServico.numero }).from(ordensServico)
      .where(doGrupo(ordensServico, x, grupo.id))),
    seHouver(ids.pedidoIds, x => exec.select({ id: pedidosVenda.id, numero: pedidosVenda.numero }).from(pedidosVenda)
      .where(doGrupo(pedidosVenda, x, grupo.id))),
    seHouver(ids.pecaVendaIds, x => exec.select({ id: vendasPecas.id, numero: vendasPecas.numero }).from(vendasPecas)
      .where(doGrupo(vendasPecas, x, grupo.id))),
  ])
  return {
    nfDaVenda: porId(vendasDb, v => v.nf),
    numeroDaOs: porId(osDb, o => o.numero),
    numeroDoPedido: porId(pedidosDb, p => p.numero),
    numeroDaPeca: porId(pecasDb, p => p.numero),
  }
}

export async function resumosDoAlvoCartao(grupo: GrupoDoRegistro, ids: IdsDoAlvoCartao, exec: Executor = db): Promise<ResumosDoAlvoCartao> {
  const [vendasDb, pecasDb, osDb] = await Promise.all([
    seHouver(ids.vendaIds, x => exec
      .select({ id: vendas.id, numero: vendas.numero, clienteNome: vendas.clienteNome, valor: vendas.valor })
      .from(vendas)
      .where(doGrupo(vendas, x, grupo.id))),
    seHouver(ids.pecaVendaIds, x => exec
      .select({ id: vendasPecas.id, numero: vendasPecas.numero, clienteNome: vendasPecas.clienteNome, valor: vendasPecas.valorTotal })
      .from(vendasPecas)
      .where(doGrupo(vendasPecas, x, grupo.id))),
    seHouver(ids.osIds, x => exec
      .select({
        id: ordensServico.id,
        numero: ordensServico.numero,
        clienteNome: sql<string>`COALESCE(${clientes.nome}, ${ordensServico.clienteNomeExterno}, ${SEM_CLIENTE})`,
        valor: ordensServico.valorTotal,
      })
      .from(ordensServico)
      // Cliente de outra Conta ligado à OS não empresta o nome.
      .leftJoin(clientes, and(eq(ordensServico.clienteId, clientes.id), eq(clientes.contaId, grupo.contaId)))
      .where(doGrupo(ordensServico, x, grupo.id))),
  ])
  return {
    vendas: porId(vendasDb, v => v),
    pecas: porId(pecasDb, p => ({ ...p, clienteNome: p.clienteNome ?? SEM_CLIENTE })),
    os: porId(osDb, o => ({ ...o, numero: o.numero ?? 0, valor: o.valor ?? '0' })),
  }
}
