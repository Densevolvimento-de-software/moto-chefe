import { cn } from '@/lib/utils'
import { fmtBRL } from '@/lib/preco-minimo'

export type LinhaDaContaDoPix = { rotulo: string; valor: number; custo?: boolean }

/**
 * A conta inteira de um PIX, como na variante B da #70: valor do PIX, custo e o que entra na conta,
 * em três colunas; no celular, linhas empilhadas. Usada no exemplo da Precificação e no PIX conciliado.
 */
export function ContaDoPix({ linhas, className }: { linhas: LinhaDaContaDoPix[]; className?: string }) {
  return (
    <dl className={cn('grid divide-y sm:grid-cols-3 sm:divide-x sm:divide-y-0', className)}>
      {linhas.map(l => (
        <div key={l.rotulo} className="flex items-center justify-between gap-2 px-3 py-2 sm:block">
          <dt className="text-xs text-muted-foreground">{l.rotulo}</dt>
          <dd className={cn('text-sm font-semibold tabular-nums', l.custo && 'text-destructive')}>{fmtBRL(l.valor)}</dd>
        </div>
      ))}
    </dl>
  )
}
