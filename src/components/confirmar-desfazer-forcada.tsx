'use client'
import { useState } from 'react'
import { toast } from 'sonner'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { SheetDescription, SheetTitle } from '@/components/ui/sheet'
import { GavetaDeBaixo } from '@/components/gaveta-de-baixo'
import { cn } from '@/lib/utils'
import type { ResultadoAction } from '@/lib/resultado-action'

/**
 * Confirmação de desfazer a forçada parcial de PIX e desvincular (#92 na /pix-mcp, #166 na /conciliacao). `modo`:
 * 'dialogo' no desktop; 'gaveta' abre a gaveta de baixo; 'folha' é o conteúdo de uma gaveta que já está aberta.
 * Enquanto envia, os botões travam e nada fecha: o pedido já saiu (`onEnviando` avisa quem segura a gaveta).
 * `descricao` é o texto principal; `nota`, o que muda, em cinza.
 */
export function ConfirmarDesfazerForcada({ modo, aberta = true, titulo, descricao, nota, desfazer, sucesso, onFechar, onDesfeito, onEnviando }: {
  modo: 'dialogo' | 'gaveta' | 'folha'
  aberta?: boolean
  titulo: string
  descricao: string
  nota?: string
  desfazer: () => Promise<ResultadoAction<unknown>>
  sucesso: string
  onFechar: () => void
  onDesfeito: () => void
  onEnviando?: (enviando: boolean) => void
}) {
  const [enviando, setEnviando] = useState(false)
  const marcar = (v: boolean) => { setEnviando(v); onEnviando?.(v) }

  async function confirmar() {
    marcar(true)
    try {
      const r = await desfazer()
      if (!r.ok) { toast.error(r.erro); return }
      onDesfeito()
      toast.success(sucesso)
    } catch {
      toast.error('Erro ao desvincular')
    } finally {
      marcar(false)
    }
  }

  const aoMudar = (abrir: boolean) => { if (!abrir && !enviando) onFechar() }
  const cancelar = <Button variant="outline" disabled={enviando} onClick={onFechar}>Cancelar</Button>
  const desfazerBotao = (
    <Button disabled={enviando} onClick={confirmar}>
      {enviando && <Loader2 className="animate-spin" />}
      {enviando ? 'Desfazendo…' : 'Desfazer e desvincular'}
    </Button>
  )
  const principal = cn(nota && 'text-foreground')

  if (modo === 'dialogo') {
    return (
      <Dialog open={aberta} onOpenChange={aoMudar} disablePointerDismissal>
        <DialogContent className="sm:max-w-md" showCloseButton={!enviando}>
          <DialogHeader>
            <DialogTitle>{titulo}</DialogTitle>
            <DialogDescription className={principal}>{descricao}</DialogDescription>
          </DialogHeader>
          {nota && <p className="text-sm text-muted-foreground">{nota}</p>}
          <DialogFooter>{cancelar}{desfazerBotao}</DialogFooter>
        </DialogContent>
      </Dialog>
    )
  }

  const corpo = (
    <>
      {/* pr-10: o X de fechar da gaveta fica no canto de cima, à direita. */}
      <SheetTitle className="pr-10 text-base">{titulo}</SheetTitle>
      <SheetDescription className={cn('mt-1', principal)}>{descricao}</SheetDescription>
      {nota && <p className="mt-3 text-sm text-muted-foreground">{nota}</p>}
      {/* O principal em cima, cada botão na largura toda (protótipo v2). */}
      <div className="mt-4 flex flex-col-reverse gap-2 [&>button]:h-11 [&>button]:text-base">{cancelar}{desfazerBotao}</div>
    </>
  )
  return modo === 'gaveta' ? <GavetaDeBaixo aberta={aberta} onAbertaChange={aoMudar}>{corpo}</GavetaDeBaixo> : <div>{corpo}</div>
}
