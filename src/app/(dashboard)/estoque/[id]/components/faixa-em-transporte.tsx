'use client'
import { useState } from 'react'
import { toast } from 'sonner'
import { Loader2, PackageCheck, Truck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { marcarChegadaAction } from '../actions'

type Props = {
  moto: { id: string; modelo: string; chassi: string; disponibilidade: string | null }
  /** Mesma regra da action (motivoParaNaoMarcarChegada), calculada pela página. */
  podeMarcar: boolean
}

/** Faixa no topo da moto em transporte (#11, protótipo v2), com o botão Chegou para quem pode marcar. */
export function FaixaEmTransporte({ moto, podeMarcar }: Props) {
  const [aberto, setAberto] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  const abrir = () => { setErro(null); setAberto(true) }
  const fechar = () => { if (!enviando) setAberto(false) }

  async function confirmar() {
    setEnviando(true)
    setErro(null)
    try {
      const r = await marcarChegadaAction(moto.id)
      if (!r.ok) { setErro(r.erro); return }
      toast.success('Chegada marcada. A moto agora está em Caixa.')
      setAberto(false)
    } finally {
      setEnviando(false)
    }
  }

  const reserva = moto.disponibilidade === 'reservada' ? ' A reserva continua.' : ''

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-info/30 bg-info/10 px-4 py-3">
      <div className="flex items-start gap-2.5">
        <Truck size={18} className="mt-0.5 shrink-0 text-info" aria-hidden />
        <div className="text-sm">
          <p className="font-medium text-foreground">Esta moto ainda não chegou na loja</p>
          <p className="text-muted-foreground">Pode ser reservada. Montar, vender e transferir só depois da chegada.</p>
        </div>
      </div>
      {podeMarcar && (
        // Par info/card já medido na tabela de contraste (identidade-visual.md): sem cor nova.
        <Button size="lg" onClick={abrir} className="bg-info text-card hover:bg-info/90">
          <PackageCheck aria-hidden />
          Chegou
        </Button>
      )}

      <Dialog open={aberto} onOpenChange={a => { if (!a) fechar() }} disablePointerDismissal>
        <DialogContent className="sm:max-w-md" showCloseButton={!enviando}>
          <DialogHeader>
            <DialogTitle>Marcar chegada</DialogTitle>
            <DialogDescription>
              A {moto.modelo} {moto.chassi} chegou na loja? Ela passa para Caixa e fica pronta para montar.{reserva}
            </DialogDescription>
          </DialogHeader>
          {erro && <p role="alert" className="text-sm text-destructive">{erro}</p>}
          <DialogFooter>
            <Button variant="outline" onClick={fechar} disabled={enviando}>Cancelar</Button>
            <Button onClick={confirmar} disabled={enviando}>
              {enviando && <Loader2 className="animate-spin" aria-hidden />}
              Marcar chegada
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
