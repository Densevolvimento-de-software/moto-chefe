'use client'

import { Loader2, TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'

// Chaves de quem está sendo gravado: a tela sabe de qual interruptor ou linha é o erro e o envio.
export const chaveDaLoja = (id: string) => `loja:${id}`
export const chaveDaConta = (id: string) => `conta:${id}`

export function Interruptor({ chave, checado, enviando, rotuloAcessivel, rotulos, onMudar }: {
  chave: string
  checado: boolean
  enviando: Record<string, boolean>
  rotuloAcessivel: string
  rotulos: { ligado: string; desligado: string }
  onMudar: (v: boolean) => void
}) {
  const salvando = enviando[chave] === true
  // Enquanto envia, mostra o valor pedido: é o que o usuário acabou de escolher.
  const mostrado = salvando ? !checado : checado
  return (
    <div className="flex items-center gap-2">
      <Switch checked={mostrado} disabled={salvando} onCheckedChange={onMudar} aria-label={rotuloAcessivel} />
      <span className="text-sm">
        {salvando
          ? <span className="inline-flex items-center gap-1.5"><Loader2 className="size-3.5 animate-spin" aria-hidden />Salvando</span>
          : (mostrado ? rotulos.ligado : rotulos.desligado)}
      </span>
    </div>
  )
}

// Erro da gravação: o texto do protótipo, acima da linha, com Tentar de novo (repete a mesma ação).
export function MensagemDeErro({ texto, onTentar, className = '' }: { texto: string; onTentar: () => void; className?: string }) {
  return (
    <div role="alert" className={`bg-destructive/10 text-destructive flex w-full items-start gap-2 rounded-lg px-3 py-2 text-sm ${className}`}>
      <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="space-y-2">
        <p>{texto}</p>
        <Button type="button" variant="outline" size="sm" onClick={onTentar}>Tentar de novo</Button>
      </div>
    </div>
  )
}
