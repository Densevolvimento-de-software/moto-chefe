import { CheckCircle2, Clock, Layers, FileCheck } from 'lucide-react'
import { cardDoStatus, type StatusDeEstoque } from '@/lib/status-moto'

type Counts = {
  total:        number
  caixa:        number
  montada:      number
  disponivel:   number
  reservada:    number
  em_garantia:  number
  aguardando_nf: number
}

type Props = { counts: Counts }

// Card de um status: rótulo, ícone e cores vêm da lista única de status.
function cardDe(status: StatusDeEstoque) {
  const card = cardDoStatus(status)
  return { key: status, label: card.rotulo, icon: card.icone, value: (c: Counts) => c[status], text: card.numero, bg: card.fundo, border: card.borda, icon_c: card.corIcone }
}

const items = [
  { key: 'total'         as const, label: 'Total',       icon: Layers,       value: (c: Counts) => c.total,         text: 'text-foreground',  bg: 'bg-muted',  border: 'border-border', icon_c: 'text-muted-foreground'  },
  cardDe('caixa'),
  cardDe('montada'),
  { key: 'disponivel'    as const, label: 'Disponíveis', icon: CheckCircle2, value: (c: Counts) => c.disponivel,    text: 'text-success',  bg: 'bg-success/10',  border: 'border-success/30', icon_c: 'text-success'  },
  { key: 'reservada'     as const, label: 'Reservadas',  icon: Clock,        value: (c: Counts) => c.reservada,     text: 'text-warning',  bg: 'bg-warning/10',  border: 'border-warning/30', icon_c: 'text-warning'  },
  cardDe('em_garantia'),
  { key: 'aguardando_nf' as const, label: 'Ag. NF',      icon: FileCheck,    value: (c: Counts) => c.aguardando_nf, text: 'text-info',   bg: 'bg-info/10',   border: 'border-info/30',  icon_c: 'text-info'   },
]

export function StatusCards({ counts }: Props) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-7 gap-3">
      {items.map(({ key, label, icon: Icon, value, text, bg, border, icon_c }) => (
        <div key={key} className={`rounded-xl border ${border} ${bg} px-4 py-3`}>
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-muted-foreground">{label}</span>
            <Icon size={14} className={icon_c} />
          </div>
          <p className={`text-2xl font-bold ${text}`}>{value(counts)}</p>
        </div>
      ))}
    </div>
  )
}
