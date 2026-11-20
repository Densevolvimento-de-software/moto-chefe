'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Loader2, TriangleAlert, Undo2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
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
  const [enviando, setEnviando] = useState(false)
  const texto = frasesDaForcada(forcada, rotulo)

  async function desfazer() {
    setEnviando(true)
    try {
      const r = await desfazerForcadaERemoverAction(id)
      if (!r.ok) { toast.error(r.erro); return }
      setConfirmando(false)
      onDesfeito()
      toast.success('Forçada desfeita e correspondência desvinculada')
    } catch {
      toast.error('Erro ao desvincular')
    } finally {
      setEnviando(false)
    }
  }

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
      {/* Enquanto envia, nem Escape nem clique fora fecham: o pedido já saiu. */}
      <Dialog open={confirmando} onOpenChange={aberto => { if (!aberto && !enviando) setConfirmando(false) }} disablePointerDismissal>
        <DialogContent className="sm:max-w-md" showCloseButton={!enviando}>
          <DialogHeader>
            <DialogTitle>Desfazer a forçada e desvincular?</DialogTitle>
            <DialogDescription>{texto.dialogo}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" disabled={enviando} onClick={() => setConfirmando(false)}>Cancelar</Button>
            <Button disabled={enviando} onClick={desfazer}>
              {enviando && <Loader2 className="animate-spin" />}
              {enviando ? 'Desfazendo…' : 'Desfazer e desvincular'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
