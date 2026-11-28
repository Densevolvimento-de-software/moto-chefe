'use client'

import { Badge } from '@/components/ui/badge'
import type { LojaDaTela } from '@/lib/motochefe-marcacao'
import { chaveDaLoja, Interruptor, MensagemDeErro } from './interruptor'

// Uma loja da Conta escolhida: nome e cidade, a situação (Ativa ou Inativa) e o interruptor de marcação.
// O erro da gravação aparece acima da linha.
export function LinhaDaLoja({ loja, checado, salvando, erro, onMudar, onTentar }: {
  loja: LojaDaTela
  checado: boolean
  salvando: boolean
  erro: { texto: string } | null
  onMudar: (v: boolean) => void
  onTentar: () => void
}) {
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 px-4 py-3">
      {erro && <MensagemDeErro className="col-span-3" texto={erro.texto} onTentar={onTentar} />}
      <div className="min-w-0">
        <strong className={`block ${loja.ativa ? '' : 'text-muted-foreground'}`}>{loja.nome}</strong>
        <span className="text-muted-foreground block text-sm">{loja.cidade}</span>
      </div>
      {loja.ativa
        ? <Badge className="bg-success/15 text-success">Ativa</Badge>
        : <Badge variant="outline" className="text-muted-foreground">Inativa</Badge>}
      <Interruptor
        checado={checado}
        salvando={salvando}
        rotuloAcessivel={`Loja MotoChefe: ${loja.nome}`}
        rotulos={{ ligado: 'Marcada', desligado: 'Desmarcada' }}
        onMudar={onMudar}
      />
    </li>
  )
}
