'use client'
import type { ReactNode } from 'react'
import { Sheet, SheetContent } from '@/components/ui/sheet'

/**
 * Gaveta que sobe do pé da tela no celular (detalhe do cartão, filtros): o conteúdo rola por dentro, até 85% da
 * altura. O título acessível (SheetTitle) vem de quem usa.
 */
export function GavetaDeBaixo({ aberta, onAbertaChange, children }: {
  aberta: boolean
  onAbertaChange: (aberta: boolean) => void
  children: ReactNode
}) {
  return (
    <Sheet open={aberta} onOpenChange={onAbertaChange}>
      <SheetContent side="bottom" className="max-h-[85dvh] gap-0 overflow-y-auto rounded-t-2xl p-4 pb-8">{children}</SheetContent>
    </Sheet>
  )
}
