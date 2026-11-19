import type { ReactNode } from 'react'

/** Rótulo à esquerda e valor à direita, com divisória: as linhas da gaveta de detalhe no celular. */
export function LinhaDeDetalhe({ rotulo, children }: { rotulo: string; children: ReactNode }) {
  return (
    <div className="flex justify-between gap-3 border-b border-border py-2 last:border-0">
      <span className="text-muted-foreground">{rotulo}</span>
      <span className="min-w-0 text-right break-words">{children}</span>
    </div>
  )
}
