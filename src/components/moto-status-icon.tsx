import { rotuloDoStatus, statusDaLista } from '@/lib/status-moto'

export function MotoStatusIcon({ status }: { status: string }) {
  const item = statusDaLista(status)
  // Status fora da lista sai pelo nome, sem ícone: nunca como "Caixa" (#941).
  if (!item) return <span className="text-muted-foreground text-sm">{rotuloDoStatus(status)}</span>
  const { icone: Icone, texto, classeIcone } = item.selo
  return (
    <span className={`flex items-center gap-1 ${texto} text-sm`}>
      <Icone size={15} className={classeIcone} />
      {item.rotulo}
    </span>
  )
}
