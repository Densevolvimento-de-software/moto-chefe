'use client'
import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Link2, Link2Off, Loader2, CheckCircle2, Search } from 'lucide-react'
import { buscarVendasParaVincular, buscarVendaManual, vincularVendaAction, desvincularVendaAction } from '../actions'
import { dataPuraBr } from '@/lib/data-venda'
import { brl } from '@/lib/dashboard-painel'
import { cn } from '@/lib/utils'
import { LINHA_PIX } from '@/lib/conciliacao-cartao'
import { tiposDoPagamentoDaLinha } from '@/lib/conciliacao-status'
import type { AlvoTipo } from '@/lib/conciliacao-alvo'

type Venda = Awaited<ReturnType<typeof buscarVendasParaVincular>>[number]
type PgtoItem = { tipo: string; valor: number | string; operadora?: string; parcelas?: number; autorizacao?: string }

// Rótulo do pagamento que a linha cobre (cartão, ou PIX para a linha pix da maquininha).
const ROTULO_DO_PAGAMENTO: Record<string, string> = {
  cartao_credito: 'Crédito',
  cartao_debito:  'Débito',
  link_pagamento: 'Link',
  pix:            'PIX',
}

type Props = {
  conciliacaoId: string
  dataRef: string
  valorRef: number
  vendaVinculada?: { id: string; numero: number; clienteNome: string; valor: string } | null
  tipoVinculado?: AlvoTipo
  /** Tipo da linha: a linha pix da maquininha procura e mostra o pagamento PIX da venda (#51). */
  tipoLinha?: string
  tamanho?: Tamanho
}

/** 'toque': 44 px, na lista do celular; 'largo': 44 px na largura toda, na folha; sem tamanho: pequeno, na tabela. */
type Tamanho = 'toque' | 'largo'
const CLASSE_DO_VINCULAR: Record<Tamanho | 'tabela', string> = {
  tabela: 'h-7 text-xs px-2 text-muted-foreground',
  toque: 'h-11 px-3',
  largo: 'h-11 w-full',
}

/** "PA" (venda de peça) ou "OS" antes do número; venda de moto não tem. */
export function ChipDoAlvo({ tipo, className }: { tipo?: AlvoTipo; className?: string }) {
  if (tipo !== 'peca' && tipo !== 'os') return null
  return <span className={cn('text-xs font-semibold text-info bg-info/10 rounded px-1 py-0.5', className)}>{tipo === 'peca' ? 'PA' : 'OS'}</span>
}

/**
 * "#31902, Maria": a venda da linha na tabela, com ou sem o Desvincular ao lado. `estornada`: a venda de que o dinheiro
 * voltou, sem o selo verde de ligada.
 */
export function RotuloDoAlvo({ numero, clienteNome, tipo, estornada = false }: {
  numero: number; clienteNome: string; tipo?: AlvoTipo; estornada?: boolean
}) {
  return (
    <span className={cn('flex items-center gap-1 text-xs font-medium', !estornada && 'text-success')}>
      {!estornada && <CheckCircle2 size={12} />}
      <ChipDoAlvo tipo={tipo} />
      #{numero}, {clienteNome.split(' ')[0]}
    </span>
  )
}

/** Tira o vínculo da linha. 'largo': botão da folha do celular; sem tamanho, só o ícone da tabela. */
export function BotaoDesvincular({ conciliacaoId, tamanho }: { conciliacaoId: string; tamanho?: 'largo' }) {
  const [pending, startTransition] = useTransition()

  function desvincular() {
    startTransition(async () => {
      try {
        const r = await desvincularVendaAction(conciliacaoId)
        if (!r.ok) { toast.error(r.erro); return }
        toast.success('Vínculo removido')
      } catch {
        toast.error('Erro ao desvincular')
      }
    })
  }

  const px = tamanho ? 16 : 12
  const icone = pending ? <Loader2 size={px} className="animate-spin" /> : <Link2Off size={px} />
  if (tamanho) {
    return (
      <Button variant="outline" onClick={desvincular} disabled={pending} className="h-11 w-full text-destructive">
        {icone} Desvincular da venda
      </Button>
    )
  }
  return (
    <button
      onClick={desvincular}
      disabled={pending}
      title="Desvincular"
      className="text-muted-foreground hover:text-destructive transition-colors"
    >
      {icone}
    </button>
  )
}

export function VincularVendaButton({ conciliacaoId, dataRef, valorRef, vendaVinculada, tipoVinculado, tipoLinha, tamanho }: Props) {
  const tiposDaLinha = tiposDoPagamentoDaLinha(tipoLinha)
  const linhaPix = tipoLinha === LINHA_PIX
  const [open, setOpen]               = useState(false)
  const [vendas, setVendas]           = useState<Venda[]>([])
  const [carregando, setCarregando]   = useState(false)
  const [pending, startTransition]    = useTransition()

  const [buscaQuery, setBuscaQuery]           = useState('')
  const [buscaResultados, setBuscaResultados] = useState<Venda[]>([])
  const [buscandoManual, setBuscandoManual]   = useState(false)
  const [buscouManual, setBuscouManual]       = useState(false)

  async function abrirModal() {
    setOpen(true)
    setBuscaQuery('')
    setBuscaResultados([])
    setBuscouManual(false)
    setCarregando(true)
    try {
      const lista = await buscarVendasParaVincular(conciliacaoId)
      setVendas(lista)
    } finally {
      setCarregando(false)
    }
  }

  async function buscarManual() {
    if (!buscaQuery.trim()) return
    setBuscandoManual(true)
    setBuscouManual(false)
    try {
      const res = await buscarVendaManual(buscaQuery)
      setBuscaResultados(res)
      setBuscouManual(true)
    } finally {
      setBuscandoManual(false)
    }
  }

  function vincular(alvoId: string, tipo: AlvoTipo) {
    startTransition(async () => {
      try {
        const r = await vincularVendaAction(conciliacaoId, { tipo, id: alvoId })
        if (!r.ok) { toast.error(r.erro); return }
        toast.success('Venda vinculada')
        setOpen(false)
      } catch {
        // A recusa com frase já voltou em `r.erro`; aqui só cai falha interna, sem frase legível.
        toast.error('Erro ao vincular')
      }
    })
  }

  function renderVenda(v: Venda, force = false) {
    const pgtos = (v.pagamentos as PgtoItem[] | null) ?? []
    const pgtoDaLinha = pgtos.filter(p => tiposDaLinha.has(p.tipo))

    return (
      <button
        key={v.id}
        onClick={() => vincular(v.id, v.tipo)}
        disabled={pending}
        className={`w-full text-left px-3 py-2.5 rounded-lg border transition-colors text-sm ${
          force
            ? 'border-warning/30 hover:border-warning/50 hover:bg-warning/10'
            : 'border-border hover:border-info/50 hover:bg-info/10'
        }`}
      >
        <div className="flex items-center justify-between">
          <span className="font-medium text-foreground">
            <ChipDoAlvo tipo={v.tipo} className="mr-1.5" />
            {v.tipo === 'os' ? `OS #${v.numero}` : `Venda #${v.numero}`}, {v.clienteNome}
          </span>
          <span className="font-semibold text-foreground">
            {v.valor ? brl(parseFloat(v.valor)) : '-'}
          </span>
        </div>
        <div className="text-xs text-muted-foreground mt-0.5">
          {v.dataVenda
            ? new Date(v.dataVenda).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })
            : '-'}
          {' · '}{v.formaPagamento}
        </div>
        {pgtoDaLinha.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1.5">
            {pgtoDaLinha.map((p, i) => (
              <span
                key={i}
                className={`text-xs px-1.5 py-0.5 rounded font-medium ${
                  force ? 'bg-warning/15 text-warning' : 'bg-info/15 text-info'
                }`}
              >
                {ROTULO_DO_PAGAMENTO[p.tipo]}
                {p.parcelas && p.parcelas > 1 ? ` ${p.parcelas}x` : ''}{' '}
                {parseFloat(String(p.valor)).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                {p.autorizacao ? ` · ${p.autorizacao}` : ''}
                {p.operadora ? ` · ${p.operadora}` : ''}
              </span>
            ))}
          </div>
        )}
      </button>
    )
  }

  if (vendaVinculada) {
    return (
      <div className="flex items-center gap-1.5">
        <RotuloDoAlvo numero={vendaVinculada.numero} clienteNome={vendaVinculada.clienteNome} tipo={tipoVinculado} />
        <BotaoDesvincular conciliacaoId={conciliacaoId} />
      </div>
    )
  }

  return (
    <>
      <Button
        variant={tamanho ? 'outline' : 'ghost'}
        size="sm"
        className={CLASSE_DO_VINCULAR[tamanho ?? 'tabela']}
        onClick={abrirModal}
      >
        <Link2 size={tamanho ? 16 : 12} className="mr-1" /> Vincular
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <div className="flex flex-wrap items-center gap-2">
              <DialogTitle>Vincular a uma venda</DialogTitle>
              {linhaPix && <span className="rounded bg-muted px-1.5 py-0.5 text-xs font-medium text-muted-foreground">PIX na maquininha</span>}
            </div>
            <p className="text-sm text-muted-foreground">
              Recebimento de{' '}
              <span className="font-semibold">{valorRef.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</span>
              {' '}em {dataPuraBr(dataRef)}
            </p>
          </DialogHeader>

          {/* ── Sugestões automáticas ── */}
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
              Sugestões por valor
            </p>

            {carregando && (
              <div className="flex items-center justify-center py-6">
                <Loader2 size={20} className="animate-spin text-muted-foreground" />
              </div>
            )}

            {!carregando && vendas.length === 0 && (
              <p className="text-sm text-muted-foreground py-2">
                {linhaPix ? 'Nenhuma venda com PIX no valor exato encontrada.' : 'Nenhuma venda com cartão no valor exato encontrada.'}
              </p>
            )}

            {!carregando && vendas.length > 0 && (
              <div className="space-y-1.5 max-h-60 overflow-y-auto">
                {vendas.map(v => renderVenda(v, false))}
              </div>
            )}
          </div>

          {/* ── Forçar vínculo ── */}
          <div className="border-t pt-4">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">
              Forçar vínculo
            </p>
            <p className="text-xs text-muted-foreground mb-2">
              Pesquise pelo número da venda ou nome do cliente para vincular manualmente.
            </p>

            <div className="flex gap-2">
              <input
                type="text"
                value={buscaQuery}
                onChange={e => { setBuscaQuery(e.target.value); setBuscouManual(false) }}
                onKeyDown={e => e.key === 'Enter' && buscarManual()}
                placeholder="Nº da venda ou nome do cliente"
                className="flex-1 border border-border rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-warning/50"
              />
              <Button
                size="sm"
                variant="outline"
                onClick={buscarManual}
                disabled={buscandoManual || !buscaQuery.trim()}
                className="border-warning/30 text-warning hover:bg-warning/10"
              >
                {buscandoManual
                  ? <Loader2 size={13} className="animate-spin" />
                  : <Search size={13} />
                }
              </Button>
            </div>

            {buscouManual && buscaResultados.length === 0 && (
              <p className="text-xs text-muted-foreground mt-2">Nenhuma venda encontrada.</p>
            )}

            {buscaResultados.length > 0 && (
              <div className="mt-2 space-y-1.5">
                {buscaResultados.map(v => renderVenda(v, true))}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
