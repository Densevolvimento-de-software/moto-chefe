'use client'

import { useState } from 'react'
import { TriangleAlert, Undo2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ConfirmarDesfazerForcada } from '@/components/confirmar-desfazer-forcada'
import { useIsDesktop } from '@/hooks/use-is-desktop'
import { frasesDaForcada } from '@/lib/forcada-frases'
import type { ForcadaQueOPixCompleta } from '@/lib/conciliacao-status'
import { desfazerForcadaERemoverAction } from '../actions'

type Props = { id: string; rotulo: string; forcada: ForcadaQueOPixCompleta; podeDesfazer: boolean; onDesfeito: () => void }

/**
 * O PIX completa um pagamento marcado como recebido só em parte (#92, variante 2 do protótipo): a caixa diz quanto,
 * e quem gere a conciliação desfaz a forçada e desvincula de uma vez, depois de confirmar no diálogo.
 */
export function ForcadaDoPix({ id, rotulo, forcada, podeDesfazer, onDesfeito }: Props) {
  const [confirmando, setConfirmando] = useState(false)
  const texto = frasesDaForcada(forcada, rotulo)
  const desktop = useIsDesktop()

  return (
    <div role="alert" className="basis-full space-y-2 rounded-lg bg-warning/10 p-3 text-xs">
      <p className="flex items-start gap-2 font-semibold text-warning">
        <TriangleAlert size={16} className="mt-px shrink-0" />
        Este PIX completa um pagamento marcado como recebido
      </p>
      <p className="text-foreground">
        {texto.caixa}
      </p>
      {podeDesfazer ? (
        <Button type="button" size="sm" onClick={() => setConfirmando(true)} className="h-11 gap-1.5 text-base md:h-8 md:text-xs">
          <Undo2 size={14} /> Desfazer a forçada e desvincular
        </Button>
      ) : (
        <p className="text-muted-foreground">Para desvincular, peça a quem gere a conciliação (sócio ou aux. adm.) para desfazer a forçada.</p>
      )}
      {/* Desktop: diálogo; celular: a gaveta de baixo do repo, como no protótipo v2 (decisão do Luis registrada na #92). */}
      <ConfirmarDesfazerForcada
        modo={desktop ? 'dialogo' : 'gaveta'}
        aberta={confirmando}
        titulo="Desfazer a forçada e desvincular?"
        descricao={texto.dialogo}
        // Vai junto o que a caixa mostrou: o servidor recusa se os lançamentos mudaram desde então.
        desfazer={() => desfazerForcadaERemoverAction(id, forcada)}
        sucesso="Forçada desfeita e correspondência desvinculada"
        onFechar={() => setConfirmando(false)}
        onDesfeito={() => { setConfirmando(false); onDesfeito() }}
      />
    </div>
  )
}
