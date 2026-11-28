'use client'

import { Loader2, TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'

// Chaves de quem está sendo gravado: a tela sabe de qual interruptor ou linha é o erro e o envio.
export const chaveDaLoja = (id: string) => `loja:${id}`
export const chaveDaConta = (id: string) => `conta:${id}`

export function Interruptor({ checado, salvando, rotuloAcessivel, rotulos, onMudar }: {
  checado: boolean
  salvando: boolean
  rotuloAcessivel: string
  rotulos: { ligado: string; desligado: string }
  onMudar: (v: boolean) => void
}) {
  return (
    <div className="flex items-center gap-2">
      {/* aria-disabled e não disabled: o disabled tira o foco de quem acabou de acionar o interruptor. O Switch ignora a mudança sozinho. */}
      <Switch
        checked={checado}
        aria-disabled={salvando || undefined}
        onCheckedChange={onMudar}
        aria-label={rotuloAcessivel}
      />
      {/* A região existe antes da mudança: o leitor de tela anuncia o "Salvando" quando o texto entra. */}
      <span role="status" className="text-sm">
        {salvando
          ? <span className="inline-flex items-center gap-1.5"><Loader2 className="size-3.5 animate-spin" aria-hidden />Salvando</span>
          : (checado ? rotulos.ligado : rotulos.desligado)}
      </span>
    </div>
  )
}

// Erro da gravação: o texto do protótipo, acima da linha, com Tentar de novo (repete a mesma ação).
export function MensagemDeErro({ texto, onTentar, className = '', rotulo = 'Tentar de novo' }: { texto: string; onTentar: () => void; className?: string; rotulo?: string }) {
  return (
    <div role="alert" className={`bg-destructive/10 text-destructive flex w-full items-start gap-2 rounded-lg px-3 py-2 text-sm ${className}`}>
      <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="space-y-2">
        <p>{texto}</p>
        <Button type="button" variant="outline" size="sm" onClick={onTentar}>{rotulo}</Button>
      </div>
    </div>
  )
}
