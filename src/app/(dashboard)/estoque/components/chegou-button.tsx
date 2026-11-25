'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Loader2, PackageCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { marcarChegadaAction } from '../[id]/actions'

type Props = { motoId: string; descricao: string }

/** Chegou na linha do Showroom (#277): um clique marca, sem confirmação (a faixa da página da moto é que confirma). */
export function ChegouButton({ motoId, descricao }: Props) {
  const router = useRouter()
  const [enviando, setEnviando] = useState(false)

  async function marcar() {
    setEnviando(true)
    try {
      const r = await marcarChegadaAction(motoId)
      if (r.ok) {
        toast.success('Chegada marcada', { description: `${descricao} foi para Caixa.` })
      } else {
        toast.error(r.erro)
        // A recusa não revalida a lista (a action lança antes): sem isto a linha velha fica com o botão.
        router.refresh()
      }
    } catch {
      // Em produção o React troca a mensagem do erro lançado por Server Action (#404): frase fixa, nunca a do erro.
      toast.error('Não foi possível marcar a chegada. Tente de novo.')
    } finally {
      setEnviando(false)
    }
  }

  const rotulo = enviando ? 'Marcando' : 'Chegou'
  return (
    // Par info/card já medido na tabela de contraste (identidade-visual.md): sem cor nova.
    <Button
      onClick={marcar}
      disabled={enviando}
      aria-busy={enviando}
      aria-label={`${rotulo}: ${descricao}`}
      className="px-3 text-[13px] font-semibold bg-info text-card hover:bg-info/90 disabled:opacity-75 max-md:h-10"
    >
      {enviando ? <Loader2 className="animate-spin" aria-hidden /> : <PackageCheck aria-hidden />}
      {rotulo}
    </Button>
  )
}
