// Importação da maquininha Mercado Pago (Point) de um grupo (#51): cartão e Pix viram linhas de
// conciliacoes_cartao do grupo, casadas com a venda das lojas dele; o estorno marca a linha que já existe.
// A credencial é do grupo (mercadopago_config) e toda leitura e gravação leva o grupo_id.
import { and, asc, eq, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { conciliacoesCartao, grupos, mercadopagoConfig } from '@/lib/db/schema'
import { CARTAO_ESTORNADO, cartaoNaoEstornado } from '@/lib/cartao-status'
import { decifrar } from '@/lib/cripto'
import { lojasDoGrupo } from '@/lib/conta'
import { RecusaUsuario } from '@/lib/resultado-action'
import type { TransacaoCartao } from '@/lib/conciliacao-cartao'
import { casarPorAutorizacao, casarPorValor, casou, linhaDaTransacao } from '@/lib/conciliacao-casamento'
import { classificarPagamento, type Classificacao } from '@/lib/conciliacao-mercadopago'
import { buscarPagamentosDaRodada } from './point'

// O desfecho de cada pagamento é uma destas contagens; o resumo da importação e o da rodada saem desta lista.
export const CONTAGENS = ['conciliadas', 'pendentes', 'duplicadas', 'estornos', 'estornosSemLinha', 'naoTratados', 'ignorados'] as const
export type Contagem = (typeof CONTAGENS)[number]
export type ResultadoImportacaoMp = Record<Contagem, number>

const contarDesfechos = (desfechos: readonly Contagem[]): ResultadoImportacaoMp =>
  Object.fromEntries(CONTAGENS.map(k => [k, desfechos.filter(d => d === k).length])) as ResultadoImportacaoMp

const contarMotivos = (motivos: readonly string[]): Record<string, number> =>
  motivos.reduce<Record<string, number>>((m, x) => ({ ...m, [x]: (m[x] ?? 0) + 1 }), {})

const OPERADORA = 'mercadopago'
const JANELA_MS = 7 * 24 * 60 * 60 * 1000

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

/** Grupos ativos com credencial do Mercado Pago, para a rodada diária. */
export function gruposComMercadoPago(): Promise<{ id: string; nome: string }[]> {
  return db.select({ id: grupos.id, nome: grupos.nome }).from(grupos)
    .innerJoin(mercadopagoConfig, eq(mercadopagoConfig.grupoId, grupos.id))
    .where(eq(grupos.ativo, true))
    .orderBy(asc(grupos.nome))
}

export async function importarMercadoPagoDoGrupo(
  grupoId: string,
  opts: { agora?: Date; buscar?: typeof buscarPagamentosDaRodada } = {},
): Promise<ResultadoImportacaoMp> {
  const [config] = await db.select({ token: mercadopagoConfig.token })
    .from(mercadopagoConfig).where(eq(mercadopagoConfig.grupoId, grupoId)).limit(1)
  // Grupo inexistente e grupo sem credencial recebem a mesma frase.
  if (!config) throw new RecusaUsuario('Este grupo não tem credencial do Mercado Pago.')
  const token = decifrar(config.token).toString('utf8')

  const fim = opts.agora ?? new Date()
  const inicio = new Date(fim.getTime() - JANELA_MS)
  // Tudo da API antes de gravar: erro (401, rede) propaga e nada do grupo é gravado.
  const pagamentos = await (opts.buscar ?? buscarPagamentosDaRodada)(token, { inicio, fim })
  const lojaIds = (await lojasDoGrupo(grupoId)).map(l => l.id)

  const classificacoes = pagamentos.map(classificarPagamento)
  // Um pagamento por vez, na ordem: o mesmo nsu duas vezes não pode correr em paralelo.
  const desfechos = await db.transaction(tx => classificacoes.reduce<Promise<Contagem[]>>(
    async (anteriores, c) => [...await anteriores, await desfechoDoPagamento(tx, grupoId, lojaIds, c)],
    Promise.resolve([]),
  ))

  // Só motivos e contagens: nada do pagamento nem do token vai para o log.
  const motivos = classificacoes.flatMap(c => (c.tipo === 'ignorar' || c.tipo === 'nao_tratado' ? [c.motivo] : []))
  if (motivos.length > 0) console.info('[mercadopago-importar]', JSON.stringify(contarMotivos(motivos)))
  return contarDesfechos(desfechos)
}

async function desfechoDoPagamento(tx: Tx, grupoId: string, lojaIds: string[], c: Classificacao): Promise<Contagem> {
  switch (c.tipo) {
    case 'ignorar': return 'ignorados'
    case 'nao_tratado': return 'naoTratados'
    case 'estorno': return marcarEstorno(tx, grupoId, c.chave)
    case 'transacao': return gravarLinha(tx, grupoId, lojaIds, c.transacao)
  }
}

const chaveDaLinha = (grupoId: string, nsu: string) =>
  and(eq(conciliacoesCartao.grupoId, grupoId), eq(conciliacoesCartao.operadora, OPERADORA), eq(conciliacoesCartao.nsu, nsu))

async function gravarLinha(tx: Tx, grupoId: string, lojaIds: string[], t: TransacaoCartao): Promise<Contagem> {
  const nsu = t.nsu!
  // Já gravada neste grupo: não casa de novo nem mexe no vínculo.
  const [existente] = await tx.select({ id: conciliacoesCartao.id }).from(conciliacoesCartao)
    .where(chaveDaLinha(grupoId, nsu)).limit(1)
  if (existente) return 'duplicadas'

  const porAutorizacao = t.autorizacao ? await casarPorAutorizacao(tx, lojaIds, t.autorizacao) : null
  const alvos = porAutorizacao && casou(porAutorizacao) ? porAutorizacao : await casarPorValor(tx, lojaIds, t)
  const linha = linhaDaTransacao(grupoId, OPERADORA, t, alvos, new Date())

  const inseridas = await tx.insert(conciliacoesCartao).values(linha)
    // Índice único parcial da 0182, (grupo_id, operadora, nsu) where nsu is not null: corrida com outra rodada.
    .onConflictDoNothing({
      target: [conciliacoesCartao.grupoId, conciliacoesCartao.operadora, conciliacoesCartao.nsu],
      where: sql`nsu is not null`,
    })
    .returning({ id: conciliacoesCartao.id })
  if (inseridas.length === 0) return 'duplicadas'
  return linha.conciliado ? 'conciliadas' : 'pendentes'
}

/**
 * Estornada e `conciliado = false` no MESMO update: o check da 0194 recusa estornada conciliada, e as somas
 * de receita só olham `conciliado`. O vínculo com a venda fica. A linha já estornada conta como duplicada
 * (nada muda, como a venda que já estava aqui). Sem linha: aprovado e estornado antes de uma rodada o ver;
 * nada a marcar, mas o resumo mostra.
 */
async function marcarEstorno(tx: Tx, grupoId: string, nsu: string): Promise<Contagem> {
  const marcadas = await tx.update(conciliacoesCartao)
    .set({ status: CARTAO_ESTORNADO, conciliado: false })
    .where(and(chaveDaLinha(grupoId, nsu), cartaoNaoEstornado))
    .returning({ id: conciliacoesCartao.id })
  if (marcadas.length > 0) return 'estornos'
  const [jaEstornada] = await tx.select({ id: conciliacoesCartao.id }).from(conciliacoesCartao)
    .where(chaveDaLinha(grupoId, nsu)).limit(1)
  return jaEstornada ? 'duplicadas' : 'estornosSemLinha'
}
