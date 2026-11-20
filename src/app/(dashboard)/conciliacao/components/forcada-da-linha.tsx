'use client'
import { useState } from 'react'
import { toast } from 'sonner'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { SheetTitle } from '@/components/ui/sheet'
import { frasesDaForcada } from '@/lib/forcada-frases'
import type { ForcadaQueOPixCompleta } from '@/lib/conciliacao-status'
import { desfazerForcadaEDesvincularLinhaAction } from '../actions'

// #166, variante 2 do protótipo: a linha completa uma forçada parcial de PIX; Desvincular abre direto a confirmação
// (diálogo na tabela; no celular, a própria folha vira a confirmação). O servidor decide o que desfaz.
const TITULO = 'Esta linha completa um pagamento marcado como recebido'

type Props = { conciliacaoId: string; rotulo: string; forcada: ForcadaQueOPixCompleta }

/** Desfaz a forçada e desvincula; `enviando` trava os botões e o fechar (o pedido já saiu). */
function useDesfazer(conciliacaoId: string, onDesfeito: () => void, onEnviando?: (enviando: boolean) => void) {
  const [enviando, setEnviando] = useState(false)
  const marcar = (v: boolean) => { setEnviando(v); onEnviando?.(v) }
  async function desfazer() {
    marcar(true)
    try {
      const r = await desfazerForcadaEDesvincularLinhaAction(conciliacaoId)
      if (!r.ok) { toast.error(r.erro); return }
      onDesfeito()
      toast.success('Forçada desfeita e linha desvinculada')
    } catch {
      toast.error('Erro ao desvincular')
    } finally {
      marcar(false)
    }
  }
  return { enviando, desfazer }
}

const Confirmar = ({ enviando, onClick }: { enviando: boolean; onClick: () => void }) => (
  <Button disabled={enviando} onClick={onClick} className="max-sm:h-11">
    {enviando && <Loader2 className="animate-spin" />}
    {enviando ? 'Desfazendo…' : 'Desfazer e desvincular'}
  </Button>
)

/** Na tabela: o diálogo que explica e confirma. */
export function DialogoDaForcada({ conciliacaoId, rotulo, forcada, onFechar }: Props & { onFechar: () => void }) {
  const { enviando, desfazer } = useDesfazer(conciliacaoId, onFechar)
  const texto = frasesDaForcada(forcada, rotulo, 'esta linha')
  return (
    <Dialog open onOpenChange={aberto => { if (!aberto && !enviando) onFechar() }} disablePointerDismissal>
      <DialogContent className="sm:max-w-md" showCloseButton={!enviando}>
        <DialogHeader>
          <DialogTitle>{TITULO}</DialogTitle>
          <DialogDescription className="text-foreground">{texto.caixa}</DialogDescription>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">{texto.dialogo}</p>
        <DialogFooter>
          <Button variant="outline" disabled={enviando} onClick={onFechar}>Cancelar</Button>
          <Confirmar enviando={enviando} onClick={desfazer} />
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** No celular: o conteúdo da folha da linha vira a confirmação. `onEnviando`: a lista não deixa a folha fechar. */
export function FolhaDaForcada({ conciliacaoId, rotulo, forcada, onCancelar, onEnviando }: Props & {
  onCancelar: () => void; onEnviando: (enviando: boolean) => void
}) {
  const { enviando, desfazer } = useDesfazer(conciliacaoId, onCancelar, onEnviando)
  const texto = frasesDaForcada(forcada, rotulo, 'esta linha')
  return (
    <div className="space-y-4">
      {/* pr-10: o X de fechar da gaveta fica no canto de cima, à direita. */}
      <SheetTitle className="pr-10 text-base">{TITULO}</SheetTitle>
      <p className="text-sm">{texto.caixa}</p>
      <p className="text-sm text-muted-foreground">{texto.dialogo}</p>
      <div className="grid gap-2">
        <Confirmar enviando={enviando} onClick={desfazer} />
        <Button variant="outline" disabled={enviando} onClick={onCancelar} className="h-11">Cancelar</Button>
      </div>
    </div>
  )
}
