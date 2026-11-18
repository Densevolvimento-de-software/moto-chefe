'use client'
import { useState, useTransition } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { AlertTriangle, Landmark, TrendingDown } from 'lucide-react'
import { aprovarVendaAction, recusarVendaAction } from '../actions'
import type { AprovacaoPendente } from '@/lib/queries/motos'
import { quadroAbaixoDoMinimo, type QuadroAbaixoDoMinimo } from '@/lib/desconto'
import { aprovacoesPorPedido, contaDaAprovacao, resumoDoPedidoEmAprovacao } from '@/lib/aprovacao-venda'
import { finalDoChassi } from '@/lib/painel-fabrica'
import { fmtBRL } from '@/lib/preco-minimo'

type MotoDoPedido = { id: string; marca: string; modelo: string }
type Props = {
  aprovacoes: AprovacaoPendente[]
  /** Motos de cada pedido pendente (lista de pedidos da página): para a nota das que estão no mínimo. */
  motosDosPedidos?: Record<string, readonly MotoDoPedido[]>
  podeAprovarValorMinimo: boolean
  podeAprovarSensivel: boolean
}

// No celular os três quadrinhos lado a lado não cabem: viram lista, rótulo à esquerda, valor e diferença à direita.
function QuadroDoMinimo({ quadro }: { quadro: QuadroAbaixoDoMinimo }) {
  const itens = [
    { rotulo: 'Mínimo', valor: quadro.minimo, abaixo: 0, cor: '' },
    { rotulo: 'Venda', valor: quadro.venda, abaixo: quadro.abaixoNoPreco, cor: 'text-destructive' },
    { rotulo: quadro.rotuloLiquido, valor: quadro.liquido, abaixo: quadro.abaixoDepoisDasTaxas, cor: 'text-warning' },
  ]
  return (
    <dl className="mt-2 grid divide-y divide-border overflow-hidden rounded-lg border border-border bg-card sm:max-w-md sm:grid-cols-3 sm:gap-2 sm:divide-y-0 sm:overflow-visible sm:rounded-none sm:border-0 sm:bg-transparent">
      {itens.map(item => (
        <div key={item.rotulo} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 px-2.5 py-1.5 sm:block sm:rounded-lg sm:border sm:border-border sm:bg-card">
          <dt className="row-span-2 text-xs text-muted-foreground">{item.rotulo}</dt>
          <dd className="col-start-2 whitespace-nowrap text-right text-sm font-semibold tabular-nums text-foreground sm:text-left">{fmtBRL(item.valor)}</dd>
          {item.abaixo > 0 && (
            <dd className={`col-start-2 whitespace-nowrap text-right text-xs font-semibold tabular-nums sm:text-left ${item.cor}`}>
              {fmtBRL(item.abaixo)} abaixo
            </dd>
          )}
        </div>
      ))}
    </dl>
  )
}

const quandoPediu = (a: AprovacaoPendente) =>
  new Date(a.dataSolicitacao).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })

/** Aprovar e recusar uma linha; numa linha de pedido o servidor responde todas as do pedido (B2). */
function useResposta(id: string) {
  const [loading, setLoading] = useState(false)
  const [recusarOpen, setRecusarOpen] = useState(false)
  const [observacao, setObservacao] = useState('')

  async function aprovar() {
    setLoading(true)
    try {
      const r = await aprovarVendaAction(id)
      if (!r.ok) { toast.error(r.erro); return }
      toast.success('Venda aprovada!')
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Erro ao aprovar')
    } finally {
      setLoading(false)
    }
  }

  async function recusar() {
    setLoading(true)
    try {
      const r = await recusarVendaAction(id, observacao || undefined)
      if (!r.ok) { toast.error(r.erro); return }
      toast.success('Venda recusada')
      setRecusarOpen(false)
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Erro ao recusar')
    } finally {
      setLoading(false)
    }
  }

  return { loading, recusarOpen, setRecusarOpen, observacao, setObservacao, aprovar, recusar }
}

function DialogoRecusar({ titulo, resposta }: { titulo: string; resposta: ReturnType<typeof useResposta> }) {
  return (
    // Recusar responde o pedido inteiro: enquanto envia, nada fecha o diálogo.
    <Dialog open={resposta.recusarOpen} onOpenChange={o => { if (!resposta.loading) resposta.setRecusarOpen(o) }}>
      <DialogContent>
        <DialogHeader><DialogTitle>{titulo}</DialogTitle></DialogHeader>
        <Textarea placeholder="Observação (opcional)" value={resposta.observacao} onChange={e => resposta.setObservacao(e.target.value)} />
        <DialogFooter>
          <Button variant="outline" disabled={resposta.loading} onClick={() => resposta.setRecusarOpen(false)}>Cancelar</Button>
          <Button variant="destructive" onClick={resposta.recusar} disabled={resposta.loading}>
            {resposta.loading ? 'Recusando...' : 'Confirmar recusa'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function Linha({ aprovacao, podeAprovar }: { aprovacao: AprovacaoPendente; podeAprovar: boolean }) {
  const resposta = useResposta(aprovacao.id)
  const { loading, aprovar } = resposta
  const sensivel = aprovacao.tipo === 'pagamento_sensivel'
  const quadro = quadroAbaixoDoMinimo(aprovacao)
  const pedido = resumoDoPedidoEmAprovacao(aprovacao)
  const conta = contaDaAprovacao(aprovacao)

  return (
    <div className={`flex flex-col gap-3 rounded-lg border px-4 py-3 md:flex-row md:items-center md:justify-between ${
      sensivel ? 'bg-info/10 border-info/30' : 'bg-warning/10 border-warning/30'
    }`}>
      <div className="flex items-start gap-2.5 min-w-0 md:flex-1">
        {sensivel
          ? <Landmark size={16} className="text-info mt-0.5 shrink-0" />
          : <TrendingDown size={16} className="text-warning mt-0.5 shrink-0" />}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap wrap-anywhere">
            {aprovacao.origem === 'os' ? (
              <Link href={`/ordens-servico/${aprovacao.osId}`} className="font-medium text-foreground hover:underline">
                OS #{aprovacao.osNumero ?? '—'} — {aprovacao.osClienteNome ?? 'Cliente não identificado'}
              </Link>
            ) : aprovacao.origem === 'peca_edicao' ? (
              <span className="font-medium text-foreground">
                Edição da venda de peças #{(aprovacao.dadosVenda as { numero?: number })?.numero ?? '—'} — {(aprovacao.dadosVenda as { clienteNome?: string | null })?.clienteNome || 'Cliente não identificado'}
              </span>
            ) : aprovacao.origem === 'peca' ? (
              <span className="font-medium text-foreground">
                Venda de peças — {(aprovacao.dadosVenda as { clienteNome?: string })?.clienteNome || 'Cliente não identificado'}
              </span>
            ) : (
              <Link href={`/estoque/${aprovacao.motoId}`} className="font-medium text-foreground hover:underline">
                {pedido && `Pedido #${pedido.numero ?? ''}: `}{aprovacao.marca} {aprovacao.modelo} — {aprovacao.cor}
              </Link>
            )}
            <span className={`text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded ${
              sensivel ? 'bg-info/10 text-info' : 'bg-warning/10 text-warning'
            }`}>
              {sensivel ? 'Financiamento/Transferência' : 'Abaixo do mínimo'}
            </span>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            {aprovacao.lojaNome} · {aprovacao.vendedorNome} · {quandoPediu(aprovacao)}
          </p>
          {conta.frete > 0 && (
            <p className="text-xs text-muted-foreground mt-0.5">Moto {fmtBRL(conta.moto)} + frete {fmtBRL(conta.frete)} = {fmtBRL(conta.total)}</p>
          )}
          <p className="text-xs text-muted-foreground mt-0.5 truncate max-w-md" title={aprovacao.motivo}>{aprovacao.motivo}</p>
          {quadro && <QuadroDoMinimo quadro={quadro} />}
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 shrink-0 md:justify-end">
        {!quadro && <span className="font-bold text-foreground tabular-nums">{fmtBRL(Number(aprovacao.valor))}</span>}
        {podeAprovar ? (
          <div className="flex gap-1.5">
            <Button size="sm" className="h-8 text-xs" onClick={aprovar} disabled={loading}>Aprovar</Button>
            <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => resposta.setRecusarOpen(true)} disabled={loading}>Recusar</Button>
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">
            {sensivel ? 'Aguarda o responsável' : 'Aguarda admin/sócio'}
          </span>
        )}
      </div>

      <DialogoRecusar titulo="Recusar venda" resposta={resposta} />
    </div>
  )
}

const nomeDaMoto = (m: { marca: string | null; modelo: string | null }) => `${m.marca ?? ''} ${m.modelo ?? ''}`.trim()

/** Uma moto do pedido em aprovação: nome, final do chassi e o quadro do mínimo (ou o valor, no pagamento sensível). */
function MotoDoGrupo({ aprovacao }: { aprovacao: AprovacaoPendente }) {
  const quadro = quadroAbaixoDoMinimo(aprovacao)
  return (
    <li className="rounded-lg border border-border bg-card px-3 py-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <Link href={`/estoque/${aprovacao.motoId}`} className="font-medium text-foreground hover:underline">
          {nomeDaMoto(aprovacao)} <span className="text-xs font-normal text-muted-foreground">final {finalDoChassi(aprovacao.chassi ?? '')}</span>
        </Link>
        {quadro
          ? <span className="text-sm font-semibold tabular-nums text-destructive">{fmtBRL(quadro.abaixoDepoisDasTaxas)} abaixo</span>
          : <span className="font-semibold tabular-nums text-foreground">{fmtBRL(Number(aprovacao.valor))}</span>}
      </div>
      {quadro && <QuadroDoMinimo quadro={quadro} />}
    </li>
  )
}

/**
 * Pedido em aprovação (#25, V2 do Luis): as linhas dele (uma por moto abaixo do mínimo, D-D) num bloco só, com a nota das motos que
 * ficaram no mínimo e um "Aprovar pedido" / "Recusar pedido": a action recebe uma linha e o servidor responde todas (B2).
 */
function GrupoDoPedido({ linhas, motos, podeAprovar }: { linhas: AprovacaoPendente[]; motos: readonly MotoDoPedido[]; podeAprovar: boolean }) {
  const [primeira] = linhas
  const resposta = useResposta(primeira.id)
  const sensivel = primeira.tipo === 'pagamento_sensivel'
  const numero = resumoDoPedidoEmAprovacao(primeira)?.numero ?? ''
  const total = Math.max(motos.length, linhas.length)
  const noMinimo = sensivel ? [] : motos.filter(m => !linhas.some(l => l.motoId === m.id)).map(nomeDaMoto)
  // A conta moto + frete só vale com uma moto: no pedido de várias, o frete é do pedido, não de uma delas.
  const conta = linhas.length === 1 ? contaDaAprovacao(primeira) : null
  const titulo = total > 1 && !sensivel ? `${linhas.length} de ${total} motos abaixo do mínimo` : linhas.map(nomeDaMoto).join(', ')
  return (
    <div className={`rounded-lg border px-4 py-3 ${sensivel ? 'bg-info/10 border-info/30' : 'bg-warning/10 border-warning/30'}`}>
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="flex min-w-0 items-start gap-2.5 md:flex-1">
          {sensivel ? <Landmark size={16} className="mt-0.5 shrink-0 text-info" /> : <TrendingDown size={16} className="mt-0.5 shrink-0 text-warning" />}
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2 wrap-anywhere">
              <span className="font-medium text-foreground">Pedido #{numero}: {titulo}</span>
              <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${sensivel ? 'bg-info/10 text-info' : 'bg-warning/10 text-warning'}`}>
                {sensivel ? 'Financiamento/Transferência' : 'Abaixo do mínimo'}
              </span>
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">{primeira.lojaNome} · {primeira.vendedorNome} · {quandoPediu(primeira)}</p>
            {conta && conta.frete > 0 && <p className="mt-0.5 text-xs text-muted-foreground">Moto {fmtBRL(conta.moto)} + frete {fmtBRL(conta.frete)} = {fmtBRL(conta.total)}</p>}
            <p className="mt-0.5 max-w-md truncate text-xs text-muted-foreground" title={primeira.motivo}>{primeira.motivo}</p>
          </div>
        </div>
        {podeAprovar ? (
          <div className="grid shrink-0 grid-cols-2 gap-1.5 md:flex">
            <Button className="h-11 md:h-9" onClick={resposta.aprovar} disabled={resposta.loading}>Aprovar pedido</Button>
            <Button variant="outline" className="h-11 md:h-9" onClick={() => resposta.setRecusarOpen(true)} disabled={resposta.loading}>Recusar pedido</Button>
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">{sensivel ? 'Aguarda o responsável' : 'Aguarda admin/sócio'}</span>
        )}
      </div>
      <ul className="mt-3 space-y-2">{linhas.map(l => <MotoDoGrupo key={l.id} aprovacao={l} />)}</ul>
      {total > 1 && (
        <p className="mt-2 text-xs text-muted-foreground">
          {noMinimo.length > 0 && `${noMinimo.length === 1 ? '1 moto' : `${noMinimo.length} motos`} no mínimo neste pedido (${noMinimo.join(', ')}). `}
          Aprovar ou recusar responde o pedido inteiro.
        </p>
      )}
      <DialogoRecusar titulo={`Recusar pedido #${numero}`} resposta={resposta} />
    </div>
  )
}

export function AprovacoesPendentesPanel({ aprovacoes, motosDosPedidos = {}, podeAprovarValorMinimo, podeAprovarSensivel }: Props) {
  if (aprovacoes.length === 0) return null
  const grupos = aprovacoesPorPedido(aprovacoes)
  const pode = (a: AprovacaoPendente) => (a.tipo === 'pagamento_sensivel' ? podeAprovarSensivel : podeAprovarValorMinimo)

  return (
    <section className="space-y-3">
      <h2 className="font-semibold text-sm text-foreground flex items-center gap-1.5">
        <AlertTriangle size={15} className="text-warning" />
        Aprovações Pendentes ({grupos.length})
      </h2>
      <div className="space-y-2">
        {grupos.map(g => (g.pedidoId
          ? <GrupoDoPedido key={g.pedidoId} linhas={g.linhas} motos={motosDosPedidos[g.pedidoId] ?? []} podeAprovar={pode(g.linhas[0])} />
          : <Linha key={g.linhas[0].id} aprovacao={g.linhas[0]} podeAprovar={pode(g.linhas[0])} />))}
      </div>
    </section>
  )
}
