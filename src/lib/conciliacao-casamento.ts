/**
 * Casamento de uma transação de cartão com a venda do sistema (moto, peça ou OS), sempre
 * restrito às lojas passadas. Um lugar só para a rota das operadoras, o CSV/relatório e a importação do
 * Mercado Pago, que também montam aqui a linha nova (`linhaDaTransacao`).
 * A ordem é fixa: moto, depois peça, depois OS.
 */
import type { AnyPgColumn } from 'drizzle-orm/pg-core'
import { and, between, inArray, sql } from 'drizzle-orm'
import type { db } from '@/lib/db'
import { conciliacoesCartao, ordensServico, vendas, vendasPecas } from '@/lib/db/schema'
import { PAGAMENTO_PIX, TIPOS_CARTAO, type PgtoOS } from '@/lib/conciliacao-status'
import { addDias } from '@/lib/calendario'
import { LINHA_PIX, type TransacaoCartao } from '@/lib/conciliacao-cartao'

type Db = Pick<typeof db, 'select'>

export type Alvos = { vendaId: string | null; pecaVendaId: string | null; osId: string | null }

/** A transação casou com uma venda de moto, uma venda de peça ou uma OS. */
export const casou = (a: Alvos): boolean => (a.vendaId ?? a.pecaVendaId ?? a.osId) !== null

const TOLERANCIA = 0.05 // R$ 0,05 de tolerância no valor

type Pagamento = Pick<PgtoOS, 'tipo' | 'valor' | 'parcelas'>

export const semAlvos = (): Alvos => ({ vendaId: null, pecaVendaId: null, osId: null })

/**
 * Tipos de pagamento da venda que uma linha da conciliação de cartão pode cobrir. A linha 'pix' só
 * existe para o Pix da maquininha Mercado Pago (#51) e cobre o pagamento Pix; as outras, cartão.
 */
export function tiposDoPagamentoDaLinha(tipoLinha: string | undefined): ReadonlySet<string> {
  return tipoLinha === LINHA_PIX ? PAGAMENTO_PIX : TIPOS_CARTAO
}

/** Um lançamento do tipo que a linha cobre, do mesmo valor (±R$ 0,05) e mesmas parcelas. */
function casaPagamento(pagamentos: unknown, tipos: ReadonlySet<string>, valorBruto: number, parcelas: number): boolean {
  const pgtos = (pagamentos ?? []) as Pagamento[]
  return pgtos.some(p =>
    tipos.has(p.tipo) &&
    Math.abs(p.valor - valorBruto) <= TOLERANCIA &&
    (!p.parcelas || p.parcelas === parcelas)
  )
}

/** Mesmo dia ± 1 dia da transação: 24 h para cada lado do meio-dia UTC (o intervalo de hoje; ver a #78). */
function janelaDoDia(dataTransacao: string) {
  const meioDia = (dia: string) => new Date(dia + 'T12:00:00Z')
  const min = meioDia(addDias(dataTransacao, -1))
  const max = meioDia(addDias(dataTransacao, 1))
  return (coluna: AnyPgColumn) => between(coluna, min, max)
}

/**
 * Pela autorização registrada no pagamento da venda: `pagamentos @> [{autorizacao}]`. Com `dataTransacao`,
 * só na janela do valor: o código tem 6 caracteres e se repete com o tempo, e a importação diária do Mercado
 * Pago casa sozinha. O CSV, conferido por quem importa, segue sem janela (#78).
 */
export async function casarPorAutorizacao(db: Db, lojaIds: string[], autorizacao: string, dataTransacao?: string): Promise<Alvos> {
  const alvos = semAlvos()
  if (lojaIds.length === 0) return alvos
  const contem = (pagamentos: AnyPgColumn) =>
    sql`${pagamentos} @> ${JSON.stringify([{ autorizacao }])}::jsonb`
  const naJanela = dataTransacao ? janelaDoDia(dataTransacao) : () => undefined

  const [venda] = await db.select({ id: vendas.id }).from(vendas)
    .where(and(contem(vendas.pagamentos), inArray(vendas.lojaId, lojaIds), naJanela(vendas.dataVenda)))
    .limit(1)
  if (venda) return { ...alvos, vendaId: venda.id }

  const [peca] = await db.select({ id: vendasPecas.id }).from(vendasPecas)
    .where(and(contem(vendasPecas.pagamentos), inArray(vendasPecas.lojaId, lojaIds), naJanela(vendasPecas.dataVenda)))
    .limit(1)
  if (peca) return { ...alvos, pecaVendaId: peca.id }

  const [os] = await db.select({ id: ordensServico.id }).from(ordensServico)
    .where(and(contem(ordensServico.pagamentos), inArray(ordensServico.lojaId, lojaIds), naJanela(ordensServico.dataConclusao)))
    .limit(1)
  if (os) return { ...alvos, osId: os.id }
  return alvos
}

/** Pelo valor: mesmo dia ± 1 dia, valor bruto ±R$ 0,05, mesma qtd de parcelas, no tipo que a linha cobre. */
export async function casarPorValor(
  db: Db,
  lojaIds: string[],
  t: { dataTransacao: string; valorBruto: number; parcelas: number; tipo?: string },
): Promise<Alvos> {
  const alvos = semAlvos()
  if (lojaIds.length === 0) return alvos

  const naJanela = janelaDoDia(t.dataTransacao)
  const tipos = tiposDoPagamentoDaLinha(t.tipo)
  const casa = (v: { pagamentos: unknown }) => casaPagamento(v.pagamentos, tipos, t.valorBruto, t.parcelas)

  const vendasCandidatas = await db
    .select({ id: vendas.id, pagamentos: vendas.pagamentos })
    .from(vendas)
    .where(and(naJanela(vendas.dataVenda), inArray(vendas.lojaId, lojaIds)))
  const vendaId = vendasCandidatas.find(casa)?.id
  if (vendaId) return { ...alvos, vendaId }

  const pecasCandidatas = await db
    .select({ id: vendasPecas.id, pagamentos: vendasPecas.pagamentos })
    .from(vendasPecas)
    .where(and(naJanela(vendasPecas.dataVenda), inArray(vendasPecas.lojaId, lojaIds)))
  const pecaVendaId = pecasCandidatas.find(casa)?.id
  if (pecaVendaId) return { ...alvos, pecaVendaId }

  const osCandidatas = await db
    .select({ id: ordensServico.id, pagamentos: ordensServico.pagamentos })
    .from(ordensServico)
    .where(and(naJanela(ordensServico.dataConclusao), inArray(ordensServico.lojaId, lojaIds)))
  const osId = osCandidatas.find(casa)?.id
  if (osId) return { ...alvos, osId }
  return alvos
}

/** Valores do insert de uma linha nova de conciliacoes_cartao: conciliada quando a transação casou com algum alvo. */
export function linhaDaTransacao(grupoId: string, operadora: string, t: TransacaoCartao, alvos: Alvos, agora: Date) {
  const conciliado = casou(alvos)
  return {
    grupoId,
    operadora,
    dataTransacao: t.dataTransacao,
    nsu: t.nsu ?? null,
    autorizacao: t.autorizacao ?? null,
    valorBruto: String(t.valorBruto),
    valorLiquido: t.valorLiquido != null ? String(t.valorLiquido) : null,
    parcelas: t.parcelas,
    tipo: t.tipo,
    status: t.status,
    vendaId: alvos.vendaId,
    pecaVendaId: alvos.pecaVendaId,
    osId: alvos.osId,
    conciliado,
    conciliadoEm: conciliado ? agora : null,
    rawData: t.rawData ?? null,
  } satisfies typeof conciliacoesCartao.$inferInsert
}
