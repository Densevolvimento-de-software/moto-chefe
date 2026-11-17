'use client'
import { useState } from 'react'
import { Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { detalheDaMoto, motosParaAdicionar, type MotoDisponivel } from '@/lib/novo-pedido'

type Props = {
  aberto: boolean
  onAbertoChange: (aberto: boolean) => void
  disponiveis: readonly MotoDisponivel[]
  /** Loja do pedido (a da 1ª moto); sem ela, a 1ª marcada define. */
  lojaId?: string
  noPedido: readonly string[]
  onAdicionar: (motos: MotoDisponivel[]) => void
}

/** Painel lateral do Novo pedido (#24, V3): marca várias motos disponíveis da loja e adiciona de uma vez. */
export function AdicionarMotoPainel({ aberto, onAbertoChange, disponiveis, lojaId, noPedido, onAdicionar }: Props) {
  const [busca, setBusca] = useState('')
  const [marcadas, setMarcadas] = useState<MotoDisponivel[]>([])
  const loja = lojaId ?? marcadas[0]?.lojaId
  const lista = motosParaAdicionar(disponiveis, { lojaId: loja, fora: noPedido }, busca)
  const nomeDaLoja = disponiveis.find(m => m.lojaId === loja)?.lojaNome

  const fechar = (aberto: boolean) => {
    if (!aberto) { setBusca(''); setMarcadas([]) }
    onAbertoChange(aberto)
  }
  const alternar = (m: MotoDisponivel) =>
    setMarcadas(atual => (atual.some(x => x.id === m.id) ? atual.filter(x => x.id !== m.id) : [...atual, m]))

  return (
    <Sheet open={aberto} onOpenChange={fechar}>
      <SheetContent className="w-full gap-0 sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Adicionar moto</SheetTitle>
          <SheetDescription>{nomeDaLoja ? `${nomeDaLoja}. ` : ''}Marque quantas quiser.</SheetDescription>
        </SheetHeader>
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input aria-label="Buscar moto" placeholder="Modelo, cor ou final do chassi" className="h-11 pl-9"
              value={busca} onChange={e => setBusca(e.target.value)} />
          </div>
          {lista.length === 0
            ? <p className="text-sm text-muted-foreground">Nenhuma moto disponível com essa busca.</p>
            : (
              <ul className="divide-y divide-border rounded-lg border border-border">
                {lista.map(m => {
                  const marcada = marcadas.some(x => x.id === m.id)
                  return (
                    <li key={m.id} className={marcada ? 'bg-accent' : undefined}>
                      <label className="flex cursor-pointer items-center gap-3 p-3">
                        <input type="checkbox" className="size-5 accent-primary" checked={marcada} onChange={() => alternar(m)} />
                        <div className="min-w-0 flex-1">
                          <span className="block font-medium">{m.marca} {m.modelo}</span>
                          <span className="block text-xs text-muted-foreground">
                            {detalheDaMoto(m)}{loja ? '' : `, ${m.lojaNome}`}
                          </span>
                        </div>
                      </label>
                    </li>
                  )
                })}
              </ul>
            )}
          <p className="text-xs text-muted-foreground">
            Só motos disponíveis{nomeDaLoja ? ` da ${nomeDaLoja}` : ''}. Moto de outra loja entra depois de transferida; moto em transferência não aparece.
          </p>
        </div>
        <SheetFooter className="flex-row items-center justify-between border-t border-border">
          <span className="text-sm text-muted-foreground">{marcadas.length === 1 ? '1 moto marcada' : `${marcadas.length} motos marcadas`}</span>
          <Button className="h-11" disabled={marcadas.length === 0} onClick={() => { onAdicionar(marcadas); fechar(false) }}>
            Adicionar {marcadas.length === 1 ? '1 moto' : `${marcadas.length} motos`}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
