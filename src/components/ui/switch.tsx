"use client"

import * as React from "react"
import { Switch as SwitchPrimitive } from "@base-ui/react/switch"

import { cn } from "@/lib/utils"

// render={<button>}: o base-ui sem isto põe um span com role=switch; com o button, foco por Tab e Espaço são nativos.
// No celular, a área de toque é ampliada por um pseudo-elemento (44 px de alvo) sem mudar o desenho.
// Cor só por variável do globals.css.
function Switch({ className, ...props }: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      render={<button type="button" />}
      nativeButton
      data-slot="switch"
      className={cn(
        "relative inline-flex h-[1.15rem] w-8 shrink-0 cursor-pointer items-center rounded-full border border-transparent bg-input transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-disabled:cursor-not-allowed aria-disabled:opacity-50 data-[checked]:bg-primary max-md:before:absolute max-md:before:-inset-x-1.5 max-md:before:-inset-y-[13px] max-md:before:content-['']",
        className
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className="pointer-events-none block size-4 rounded-full bg-background shadow-sm transition-transform data-[checked]:translate-x-[calc(100%-2px)] data-[unchecked]:translate-x-0"
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
