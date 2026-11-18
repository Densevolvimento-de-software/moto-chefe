import { type ComponentProps } from 'react'
import { Search } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

/** Campo de busca com a lupa dentro, na altura de toque (h-11). Usado no Novo pedido (#24): painéis e blocos do celular. */
export function CampoBusca({ className, ...props }: ComponentProps<typeof Input>) {
  return (
    <div className="relative">
      <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
      <Input className={cn('h-11 pl-9', className)} {...props} />
    </div>
  )
}
