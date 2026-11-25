'use client'
import { useState } from 'react'
import { toast } from 'sonner'
import { Loader2, PackageCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { marcarChegadaAction } from '../[id]/actions'

type Props = { motoId: string; descricao: string }

/** Chegou na linha do Showroom (#277): um clique marca, sem confirmação (a faixa da página da moto é que confirma). */
export function ChegouButton({ motoId, descricao }: Props) {
  const [enviando, setEnviando] = useState(false)

  async function marcar() {
    setEnviando(true)
    try {
      await marcarChegadaAction(motoId)
      toast.success('Chegada marcada', { description: `${descricao} foi para Caixa.` })
    } finally {
      setEnviando(false)
    }
  }

  const rotulo = enviando ? 'Marcando' : 'Chegou'
  return (
    // Par info/card já medido na tabela de contraste (identidade-visual.md): sem cor nova.
    <Button
      size="sm"
      onClick={marcar}
      disabled={enviando}
      aria-busy={enviando}
      aria-label={`${rotulo}: ${descricao}`}
      className="h-8 bg-info text-card hover:bg-info/90 disabled:opacity-75 max-md:h-10"
    >
      {enviando ? <Loader2 className="animate-spin" aria-hidden /> : <PackageCheck aria-hidden />}
      {rotulo}
    </Button>
  )
}
