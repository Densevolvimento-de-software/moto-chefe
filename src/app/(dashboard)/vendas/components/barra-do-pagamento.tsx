import { brl } from '@/lib/dashboard-painel'
import type { SituacaoDoPagamento } from '@/lib/pagamentos-entrada'

/** Quanto do total do pedido as formas já pagam (#25): "Falta pagar", "Pago por completo" ou "Passou", com a barra. Efetivar e Editar efetivado. */
export function BarraDoPagamento({ situacao, total }: { situacao: SituacaoDoPagamento; total: number }) {
  const texto = { falta: `Falta pagar ${brl(situacao.diferenca)}`, pago: 'Pago por completo', passou: `Passou ${brl(situacao.diferenca)} do total` }[situacao.tipo]
  return (
    <div className="space-y-2 rounded-lg bg-muted p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className={`font-medium ${situacao.tipo === 'passou' ? 'text-destructive' : situacao.tipo === 'pago' ? 'text-primary-text' : ''}`}>{texto}</span>
        <span className="text-xs text-muted-foreground">{brl(situacao.pago)} de {brl(total)}</span>
      </div>
      <div className="h-2 rounded-full bg-border">
        <div className={`h-2 rounded-full ${situacao.tipo === 'passou' ? 'bg-destructive' : 'bg-primary'}`}
          style={{ width: `${total > 0 ? Math.min(100, (situacao.pago / total) * 100) : 0}%` }} />
      </div>
    </div>
  )
}
