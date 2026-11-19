import { maquininhasDoGrupo } from '@/lib/maquininhas'
import { db } from '@/lib/db'
import { conciliacoesCartao } from '@/lib/db/schema'
import { resumosDoAlvoCartao } from '@/lib/rotulos-alvo'
import { eq, desc, and, gte } from 'drizzle-orm'
import { getUsuarioLogado } from '@/lib/auth'
import { usuarioPodeAcessar } from '@/lib/navegacao-servidor'
import { getGrupoAtivo } from '@/lib/grupo'
import { INICIO_CONCILIACAO } from '@/lib/conciliacao-periodo'
import { cartaoPendente } from '@/lib/cartao-status'
import { redirect } from 'next/navigation'
import { UploadRelatorio } from './components/upload-relatorio'
import { TransacoesConciliacao } from './components/transacoes-conciliacao'
import { FaixaMercadoPago } from './components/faixa-mercadopago'
import { estadoDaFaixaMp } from '@/lib/mercadopago/importar'
import { podeGerirConciliacao } from '@/lib/conciliacao-papeis'
import { linhaNaTela } from '@/lib/conciliacao-linha-tela'
import { cn } from '@/lib/utils'

export default async function ConciliacaoPage({
  searchParams,
}: {
  searchParams: Promise<{ filtro?: string }>
}) {
  const usuario = await getUsuarioLogado()
  if (!usuarioPodeAcessar(usuario, '/conciliacao')) redirect('/dashboard')

  const { filtro = 'pendentes' } = await searchParams
  const grupo = await getGrupoAtivo(usuario)

  const filtroStatus =
    filtro === 'conciliadas' ? eq(conciliacoesCartao.conciliado, true) :
    filtro === 'todas'       ? undefined :
    // Estornada não é pendência; aparece só em "Todas".
    cartaoPendente

  // Nada de antes do início do período de conciliação — ver INICIO_CONCILIACAO.
  const doPeriodo = and(
    eq(conciliacoesCartao.grupoId, grupo.id),
    gte(conciliacoesCartao.dataTransacao, INICIO_CONCILIACAO),
  )

  const whereClause = and(doPeriodo, filtroStatus)

  const transacoes = await db
    .select({
      id:            conciliacoesCartao.id,
      operadora:     conciliacoesCartao.operadora,
      dataTransacao: conciliacoesCartao.dataTransacao,
      tipo:          conciliacoesCartao.tipo,
      parcelas:      conciliacoesCartao.parcelas,
      valorBruto:    conciliacoesCartao.valorBruto,
      valorLiquido:  conciliacoesCartao.valorLiquido,
      nsu:           conciliacoesCartao.nsu,
      status:        conciliacoesCartao.status,
      conciliado:    conciliacoesCartao.conciliado,
      vendaId:       conciliacoesCartao.vendaId,
      pecaVendaId:   conciliacoesCartao.pecaVendaId,
      osId:          conciliacoesCartao.osId,
      rawData:       conciliacoesCartao.rawData,
    })
    .from(conciliacoesCartao)
    .where(whereClause)
    .orderBy(desc(conciliacoesCartao.dataTransacao))
    .limit(200)

  // Carrega dados das vendas (motos e peças) e OS vinculadas
  const idsDe = (k: 'vendaId' | 'pecaVendaId' | 'osId') => transacoes.flatMap(t => t[k] ? [t[k]] : [])
  const alvos =
    await resumosDoAlvoCartao(grupo, { vendaIds: idsDe('vendaId'), pecaVendaIds: idsDe('pecaVendaId'), osIds: idsDe('osId') })

  // A faixa do Mercado Pago só aparece no grupo ativo com credencial (#51).
  const [totalPendentes, totalConciliadas, faixaMp] = await Promise.all([
    db.$count(conciliacoesCartao, and(doPeriodo, cartaoPendente)),
    db.$count(conciliacoesCartao, and(doPeriodo, eq(conciliacoesCartao.conciliado, true))),
    estadoDaFaixaMp(grupo.id),
  ])

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Conciliação de Cartão</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {totalPendentes} pendente{totalPendentes !== 1 ? 's' : ''} · {totalConciliadas} conciliada{totalConciliadas !== 1 ? 's' : ''}
          </p>
        </div>
        <UploadRelatorio maquininhas={await maquininhasDoGrupo(db, grupo.id)} />
      </div>

      {faixaMp && <FaixaMercadoPago estado={faixaMp} podeImportar={podeGerirConciliacao(usuario.papel)} />}

      {/* Filtros: 3 segmentos no celular (V2), botões no desktop */}
      <nav aria-label="Filtrar" className="grid grid-cols-3 rounded-lg border border-border bg-muted p-[3px] md:flex md:gap-2 md:border-0 md:bg-transparent md:p-0">
        {(['pendentes', 'conciliadas', 'todas'] as const).map(f => (
          <a
            key={f}
            href={`/conciliacao?filtro=${f}`}
            aria-current={filtro === f ? 'page' : undefined}
            className={cn(
              'flex min-h-10 items-center justify-center rounded-md text-sm font-medium transition-colors md:min-h-0 md:px-3 md:py-1.5',
              filtro === f
                ? 'bg-card text-foreground shadow-sm md:bg-primary md:text-primary-foreground'
                : 'text-muted-foreground md:border md:border-border md:bg-card md:hover:bg-muted',
            )}
          >
            {f === 'pendentes' ? 'Pendentes' : f === 'conciliadas' ? 'Conciliadas' : 'Todas'}
          </a>
        ))}
      </nav>

      {transacoes.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <p className="text-sm">
            {filtro === 'pendentes'
              ? 'Nenhuma transação pendente. Importe um relatório acima.'
              : 'Nenhuma transação encontrada.'}
          </p>
        </div>
      ) : (
        <TransacoesConciliacao linhas={transacoes.map(t => linhaNaTela(t, alvos))} podeVincular={podeGerirConciliacao(usuario.papel)} />
      )}
    </div>
  )
}
