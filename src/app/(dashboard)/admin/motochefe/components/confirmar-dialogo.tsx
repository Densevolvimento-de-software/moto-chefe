'use client'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'

// Confirmação de uma ação que tira dado da API. Sem o X e sem clique fora; Escape só fecha quando não há envio.
export function ConfirmarDialogo({ titulo, texto, rotuloEnviar, ocupado, onCancelar, onConfirmar }: {
  titulo: string
  texto: string
  rotuloEnviar: string
  ocupado: boolean
  onCancelar: () => void
  onConfirmar: () => void
}) {
  return (
    <Dialog open onOpenChange={aberto => { if (!aberto && !ocupado) onCancelar() }} disablePointerDismissal>
      <DialogContent className="sm:max-w-md" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{titulo}</DialogTitle>
          <DialogDescription>{texto}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="outline" disabled={ocupado} onClick={onCancelar}>Cancelar</Button>
          <Button type="button" variant="destructive" disabled={ocupado} onClick={onConfirmar}>{rotuloEnviar}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
