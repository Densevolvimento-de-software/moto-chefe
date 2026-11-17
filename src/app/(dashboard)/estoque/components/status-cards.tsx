import { CheckCircle2, Clock, Layers, FileCheck } from 'lucide-react'
import { cardDoStatus, type StatusDeEstoque } from '@/lib/status-moto'
import type { ContagemShowroom as Counts } from '@/lib/showroom-contagem'

type Props = { counts: Counts }

// Card de um status: rótulo, ícone e cores vêm da lista única de status. Só os status que têm contagem.
function cardDe(status: Extract<StatusDeEstoque, keyof Counts>) {
  const card = cardDoStatus(status)
  return { key: status, label: card.rotulo, icon: card.icone, value: (c: Counts) => c[status], text: card.numero, bg: card.fundo, border: card.borda, icon_c: card.corIcone }
}

const items = [
  { key: 'total'         as const, label: 'Total',       icon: Layers,       value: (c: Counts) => c.total,         text: 'text-foreground',  bg: 'bg-muted',  border: 'border-border', icon_c: 'text-muted-foreground'  },
  cardDe('em_transporte'),
  cardDe('caixa'),
  cardDe('montada'),
  { key: 'disponivel'    as const, label: 'Disponíveis', icon: CheckCircle2, value: (c: Counts) => c.disponivel,    text: 'text-success',  bg: 'bg-success/10',  border: 'border-success/30', icon_c: 'text-success'  },
  { key: 'reservada'     as const, label: 'Reservadas',  icon: Clock,        value: (c: Counts) => c.reservada,     text: 'text-warning',  bg: 'bg-warning/10',  border: 'border-warning/30', icon_c: 'text-warning'  },
  cardDe('em_garantia'),
  { key: 'aguardando_nf' as const, label: 'Ag. NF',      icon: FileCheck,    value: (c: Counts) => c.aguardando_nf, text: 'text-info',   bg: 'bg-info/10',   border: 'border-info/30',  icon_c: 'text-info'   },
]

// O card Em transporte só aparece com moto no status no recorte (P8 do #7); os outros, sempre.
const aparece = (key: (typeof items)[number]['key'], counts: Counts) => key !== 'em_transporte' || counts.em_transporte > 0

// Desktop: todos os cards numa linha. Classe escrita inteira para o Tailwind achar.
const COLUNAS_XL: Record<number, string> = { 7: 'xl:grid-cols-7', 8: 'xl:grid-cols-8' }

export function StatusCards({ counts }: Props) {
  const visiveis = items.filter(i => aparece(i.key, counts))
  return (
    <div className={`grid grid-cols-2 sm:grid-cols-4 ${COLUNAS_XL[visiveis.length]} gap-3`}>
      {visiveis.map(({ key, label, icon: Icon, value, text, bg, border, icon_c }) => (
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
