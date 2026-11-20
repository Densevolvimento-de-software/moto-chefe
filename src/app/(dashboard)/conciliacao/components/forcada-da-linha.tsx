'use client'
import { ConfirmarDesfazerForcada } from '@/components/confirmar-desfazer-forcada'
import { frasesDaForcada } from '@/lib/forcada-frases'
import type { ForcadaQueOPixCompleta } from '@/lib/conciliacao-status'
import { desfazerForcadaEDesvincularLinhaAction } from '../actions'

// #166, variante 2 do protótipo: a linha completa uma forçada parcial de PIX; Desvincular abre direto a confirmação
// (diálogo na tabela; no celular, a própria folha da linha vira a confirmação). O servidor decide o que desfaz.
type Props = { conciliacaoId: string; rotulo: string; forcada: ForcadaQueOPixCompleta; onFechar: () => void; onEnviando?: (enviando: boolean) => void }

export function ConfirmarForcadaDaLinha({ conciliacaoId, rotulo, forcada, onFechar, onEnviando, modo }: Props & { modo: 'dialogo' | 'folha' }) {
  const texto = frasesDaForcada(forcada, rotulo, 'esta linha')
  return (
    <ConfirmarDesfazerForcada
      modo={modo}
      titulo="Esta linha completa um pagamento marcado como recebido"
      descricao={texto.caixa}
      nota={texto.dialogo}
      // O resumo que a tela mostrou vai só para o servidor conferir que nada mudou.
      desfazer={() => desfazerForcadaEDesvincularLinhaAction(conciliacaoId, forcada)}
      sucesso="Forçada desfeita e linha desvinculada"
      onFechar={onFechar}
      onDesfeito={onFechar}
      onEnviando={onEnviando}
    />
  )
}
