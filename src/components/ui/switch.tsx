"use client"

import * as React from "react"
import { Switch as SwitchPrimitive } from "@base-ui/react/switch"

import { cn } from "@/lib/utils"

// render={<button>}: o base-ui sem isto põe um span com role=switch; com o button, foco por Tab e Espaço são nativos.
// No celular, a área de toque é ampliada por um pseudo-elemento: 7 px de cada lado, sobre a área interna de 30 px
// (a borda de 1 px fica fora da conta), chega a 44 px. Sem mudar o desenho.
// Cor só por variável do globals.css.
type MudancaDoSwitch = NonNullable<React.ComponentProps<typeof SwitchPrimitive.Root>['onCheckedChange']>

// Com aria-disabled, o próprio Switch ignora a mudança (o foco segue no botão, sem o disabled nativo).
function Switch({ className, onCheckedChange, ...props }: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  const travado = props['aria-disabled'] === true || props['aria-disabled'] === 'true'
  const aoMudar: MudancaDoSwitch = (...args) => { if (!travado) onCheckedChange?.(...args) }
  return (
    <SwitchPrimitive.Root
      render={<button type="button" />}
      nativeButton
      data-slot="switch"
      className={cn(
        "relative inline-flex h-[1.15rem] w-8 shrink-0 cursor-pointer items-center rounded-full border border-transparent bg-input transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-disabled:cursor-not-allowed aria-disabled:opacity-50 data-[checked]:bg-primary max-md:before:absolute max-md:before:-inset-x-[7px] max-md:before:-inset-y-[14px] max-md:before:content-['']",
        className
      )}
      {...props}
      onCheckedChange={aoMudar}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className="pointer-events-none block size-4 rounded-full bg-background shadow-sm transition-transform data-[checked]:translate-x-[calc(100%-2px)] data-[unchecked]:translate-x-0"
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
