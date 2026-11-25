'use client'
import { toast } from 'sonner'
import { PackageCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { marcarChegadaAction } from '../[id]/actions'

type Props = { motoId: string; descricao: string }

/** Chegou na linha do Showroom (#277): um clique marca, sem confirmação (a faixa da página da moto é que confirma). */
export function ChegouButton({ motoId, descricao }: Props) {
  async function marcar() {
    await marcarChegadaAction(motoId)
    toast.success('Chegada marcada', { description: `${descricao} foi para Caixa.` })
  }

  return (
    // Par info/card já medido na tabela de contraste (identidade-visual.md): sem cor nova.
    <Button size="sm" onClick={marcar} aria-label={`Chegou: ${descricao}`} className="h-8 bg-info text-card hover:bg-info/90 max-md:h-10">
      <PackageCheck aria-hidden />
      Chegou
    </Button>
  )
}
