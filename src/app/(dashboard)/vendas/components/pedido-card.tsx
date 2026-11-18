'use client'
import { useState } from 'react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { EfetivarPedidoDialog } from './efetivar-pedido-dialog'
import { CriarPedidoDialog } from './criar-pedido-dialog'
import { useMotosDisponiveis } from './motos-disponiveis'
import type { OrigemParaEscolher } from '@/lib/queries/origens-venda'
import { cancelarPedidoAction } from '../actions'
import { podeCancelarPedido } from '@/lib/pedido-venda-regras'
import type { PedidoComDetalhes } from '@/lib/queries/vendas'
import { brl } from '@/lib/dashboard-painel'
import { centavos } from '@/lib/numero-br'
import { finalDoChassi } from '@/lib/painel-fabrica'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { Bike, User, Store, CalendarDays, Hash, X, CheckCheck } from 'lucide-react'

const STATUS_CONFIG = {
  pendente:  { label: 'Pendente',  cls: 'border-warning/40 bg-warning/10 text-warning' },
  efetivado: { label: 'Efetivado', cls: 'border-success/40 bg-success/10 text-success' },
  cancelado: { label: 'Cancelado', cls: 'border-input bg-muted text-muted-foreground' },
}

type Props = {
  pedido: PedidoComDetalhes
  papel: string
  usuarioId: string
  lojaIdUsuario: string | null
  /** Origens ativas do grupo — a venda só efetiva com uma escolhida. */
  origens: OrigemParaEscolher[]
  podeAprovarSensivel: boolean
}

export function PedidoCard({ pedido: p, papel, usuarioId, lojaIdUsuario, origens, podeAprovarSensivel }: Props) {
  const motosDisponiveis = useMotosDisponiveis()
  const [cancelarOpen, setCancelarOpen] = useState(false)
  const [observacao, setObservacao] = useState('')
  const [loading, setLoading] = useState(false)

  const isAdmin = ['admin_geral', 'admin_socio'].includes(papel)

  // Em aprovação (#776): quem decide é o aprovador; efetivar e cancelar esperam.
  const aguardandoAprovacao = p.status === 'pendente' && p.emAprovacao
  const podeEfetivar = p.status === 'pendente' && !aguardandoAprovacao && ['admin_geral', 'admin_socio', 'aux_adm'].includes(papel) &&
    (isAdmin || lojaIdUsuario === p.lojaId)

  const podeCancelar = !aguardandoAprovacao && podeCancelarPedido({ id: usuarioId, papel, lojaId: lojaIdUsuario }, p)

  async function handleCancelar() {
    setLoading(true)
    try {
      const r = await cancelarPedidoAction(p.id, observacao)
      if (!r.ok) { toast.error(r.erro); return }
      setCancelarOpen(false)
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setLoading(false)
    }
  }

  const cfg = STATUS_CONFIG[p.status as keyof typeof STATUS_CONFIG] ?? STATUS_CONFIG.cancelado
  const varias = p.motos.length > 1
  // Total só com todas as motos com valor: com uma "A definir", a soma sairia pela metade.
  const totalDasMotos = p.motos.every(m => m.valor !== null) ? centavos(p.motos.reduce((s, m) => s + Number(m.valor), 0)) : null

  return (
    <>
      <div className={`rounded-xl border bg-card shadow-sm hover:shadow-md transition-shadow overflow-hidden ${
        p.status === 'cancelado' ? 'opacity-60' : ''
      }`}>
        {/* Faixa de status no topo */}
        <div className={`h-1 w-full ${
          p.status === 'pendente'  ? 'bg-warning' :
          p.status === 'efetivado' ? 'bg-success' : 'bg-muted-foreground'
        }`} />

        <div className="p-4 space-y-3">
          {/* Cabeçalho: modelo (ou "N motos") + número */}
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <div className="p-1.5 bg-muted rounded-lg shrink-0">
                <Bike size={16} className="text-muted-foreground" />
              </div>
              <div className="min-w-0">
                <p className="font-semibold text-foreground text-sm leading-tight truncate">
                  {varias ? `${p.motos.length} motos` : `${p.marca} ${p.modelo}`}
                </p>
                {!varias && <p className="text-xs font-mono text-muted-foreground truncate">{p.chassi} · {p.cor}</p>}
              </div>
            </div>
            <div className="flex flex-col items-end gap-1 shrink-0">
              <span className={`inline-flex items-center px-2 py-0.5 rounded-full border text-xs font-semibold ${cfg.cls}`}>
                {cfg.label}
              </span>
              <span className="text-[11px] font-mono text-muted-foreground flex items-center gap-0.5">
                <Hash size={10} />{p.numero}
              </span>
            </div>
          </div>

          {/* Pedido de várias motos (#25, V2): cada uma com o valor, e o total quando todas têm valor. */}
          {varias && (
            <div className="space-y-1.5">
              <ul aria-label="Motos do pedido" className="divide-y divide-border rounded-lg border border-border">
                {p.motos.map(m => (
                  <li key={m.id} className="flex justify-between gap-2 px-2.5 py-1.5 text-xs">
                    <span className="min-w-0 truncate">{m.marca} {m.modelo} <span className="text-muted-foreground">final {finalDoChassi(m.chassi)}</span></span>
                    <span className="whitespace-nowrap font-semibold tabular-nums">{m.valor ? brl(Number(m.valor)) : 'A definir'}</span>
                  </li>
                ))}
              </ul>
              {totalDasMotos !== null && (
                <p className="flex justify-between text-xs"><span className="text-muted-foreground">Total das motos</span><strong className="tabular-nums">{brl(totalDasMotos)}</strong></p>
              )}
            </div>
          )}

          {/* Infos em grid */}
          <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <Store size={12} className="shrink-0 text-muted-foreground" />
              <span className="truncate">{p.lojaNome}</span>
            </div>
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <User size={12} className="shrink-0 text-muted-foreground" />
              <span className="truncate">{p.vendedorNome}</span>
            </div>
            <div className="flex items-center gap-1.5 text-muted-foreground col-span-2">
              <CalendarDays size={12} className="shrink-0 text-muted-foreground" />
              <span>{p.dataPedido ? format(new Date(p.dataPedido), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR }) : '—'}</span>
            </div>
            {p.observacao && (
              <div className="col-span-2 text-muted-foreground italic truncate" title={p.observacao}>
                "{p.observacao}"
              </div>
            )}
          </div>

          {aguardandoAprovacao && (
            <p className="pt-1 border-t border-border text-xs font-medium text-warning">Aguardando aprovação</p>
          )}

          {/* Ações */}
          {(podeEfetivar || podeCancelar) && (
            <div className="flex gap-2 pt-1 border-t border-border">
              {podeEfetivar && (
                <EfetivarPedidoDialog pedidoId={p.id} numero={p.numero} origens={origens} entrega={p.entrega} papel={papel} podeAprovarSensivel={podeAprovarSensivel} />
              )}
              {/* Quem edita é quem cancela, e em aprovação nenhum dos dois (#25, decisões 3 e 5 do Luis). */}
              {podeCancelar && (
                <CriarPedidoDialog motos={motosDisponiveis} papel={papel} editar={{ pedidoId: p.id, numero: p.numero, entrega: p.entrega }} />
              )}
              {podeCancelar && (
                <Button size="sm" variant="ghost"
                  className="text-muted-foreground hover:text-destructive hover:bg-destructive/10 gap-1 text-xs"
                  onClick={() => setCancelarOpen(true)}>
                  <X size={13} /> Cancelar
                </Button>
              )}
            </div>
          )}
        </div>
      </div>

      <Dialog open={cancelarOpen} onOpenChange={setCancelarOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Cancelar Pedido #{p.numero}</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">{varias ? p.motos.map(m => `${m.marca} ${m.modelo}`).join(', ') : `${p.marca} ${p.modelo} · ${p.chassi}`}</p>
          <Textarea
            placeholder="Motivo do cancelamento (opcional)"
            value={observacao}
            onChange={e => setObservacao(e.target.value)}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelarOpen(false)}>Voltar</Button>
            <Button variant="destructive" onClick={handleCancelar} disabled={loading}>
              {loading ? 'Cancelando...' : 'Confirmar Cancelamento'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
