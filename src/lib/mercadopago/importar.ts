// Importação da maquininha Mercado Pago (Point) de um grupo (#51): cartão e Pix viram linhas de
// conciliacoes_cartao do grupo, casadas com a venda das lojas dele; o estorno marca a linha que já existe.
// A credencial é do grupo (mercadopago_config) e toda leitura e gravação leva o grupo_id.
import { and, asc, eq, ne, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { conciliacoesCartao, grupos, mercadopagoConfig } from '@/lib/db/schema'
import { CARTAO_ESTORNADO } from '@/lib/cartao-status'
import { decifrar } from '@/lib/cripto'
import { lojasDoGrupo } from '@/lib/conta'
import { RecusaUsuario } from '@/lib/resultado-action'
import type { TransacaoCartao } from '@/lib/conciliacao-cartao'
import { casarPorAutorizacao, casarPorValor, linhaDaTransacao } from '@/lib/conciliacao-casamento'
import { classificarPagamento } from '@/lib/conciliacao-mercadopago'
import { buscarPagamentosDaRodada } from './point'

export type ResultadoImportacaoMp = {
  importadas: number; duplicadas: number; conciliadas: number; estornos: number; naoTratados: number; ignorados: number
}

const OPERADORA = 'mercadopago'
const JANELA_MS = 7 * 24 * 60 * 60 * 1000

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]
type Gravacao = 'duplicada' | 'conciliada' | 'pendente'

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

  const r: ResultadoImportacaoMp = { importadas: 0, duplicadas: 0, conciliadas: 0, estornos: 0, naoTratados: 0, ignorados: 0 }
  const motivos = new Map<string, number>()
  const contarMotivo = (m: string) => motivos.set(m, (motivos.get(m) ?? 0) + 1)

  await db.transaction(async tx => {
    for (const p of pagamentos) {
      const c = classificarPagamento(p)
      if (c.tipo === 'ignorar') { r.ignorados++; contarMotivo(c.motivo) }
      else if (c.tipo === 'nao_tratado') { r.naoTratados++; contarMotivo(c.motivo) }
      else if (c.tipo === 'estorno') { if (await marcarEstorno(tx, grupoId, c.chave)) r.estornos++ }
      else {
        const g = await gravarLinha(tx, grupoId, lojaIds, c.transacao)
        if (g === 'duplicada') r.duplicadas++
        else { r.importadas++; if (g === 'conciliada') r.conciliadas++ }
      }
    }
  })

  // Só motivos e contagens: nada do pagamento nem do token vai para o log.
  if (motivos.size > 0) console.info('[mercadopago-importar]', JSON.stringify(Object.fromEntries(motivos)))
  return r
}

const chaveDaLinha = (grupoId: string, nsu: string) =>
  and(eq(conciliacoesCartao.grupoId, grupoId), eq(conciliacoesCartao.operadora, OPERADORA), eq(conciliacoesCartao.nsu, nsu))

async function gravarLinha(tx: Tx, grupoId: string, lojaIds: string[], t: TransacaoCartao): Promise<Gravacao> {
  const nsu = t.nsu!
  // Já gravada neste grupo: não casa de novo nem mexe no vínculo.
  const [existente] = await tx.select({ id: conciliacoesCartao.id }).from(conciliacoesCartao)
    .where(chaveDaLinha(grupoId, nsu)).limit(1)
  if (existente) return 'duplicada'

  const porAutorizacao = t.autorizacao ? await casarPorAutorizacao(tx, lojaIds, t.autorizacao) : null
  const casouPorAutorizacao = porAutorizacao && (porAutorizacao.vendaId ?? porAutorizacao.pecaVendaId ?? porAutorizacao.osId)
  const alvos = casouPorAutorizacao ? porAutorizacao : await casarPorValor(tx, lojaIds, t)
  const linha = linhaDaTransacao(grupoId, OPERADORA, t, alvos, new Date())

  const inseridas = await tx.insert(conciliacoesCartao).values(linha)
    // Índice único parcial da 0182, (grupo_id, operadora, nsu) where nsu is not null: corrida com outra rodada.
    .onConflictDoNothing({
      target: [conciliacoesCartao.grupoId, conciliacoesCartao.operadora, conciliacoesCartao.nsu],
      where: sql`nsu is not null`,
    })
    .returning({ id: conciliacoesCartao.id })
  if (inseridas.length === 0) return 'duplicada'
  return linha.conciliado ? 'conciliada' : 'pendente'
}

/**
 * Estornada e `conciliado = false` no MESMO update: o check da 0194 recusa estornada conciliada, e as somas
 * de receita só olham `conciliado`. O vínculo com a venda fica. Linha já estornada fica de fora, para o
 * estorno não contar de novo a cada rodada da janela; pagamento estornado sem linha não grava nada.
 */
async function marcarEstorno(tx: Tx, grupoId: string, nsu: string): Promise<boolean> {
  const linhas = await tx.update(conciliacoesCartao)
    .set({ status: CARTAO_ESTORNADO, conciliado: false })
    .where(and(chaveDaLinha(grupoId, nsu), ne(conciliacoesCartao.status, CARTAO_ESTORNADO)))
    .returning({ id: conciliacoesCartao.id })
  return linhas.length > 0
}
