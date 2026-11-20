'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Unlink } from 'lucide-react'
import { forcadaDoPixAction, lancarCorrespondenciaAction, removerCorrespondenciaAction } from '../actions'
import { COMPLETA_FORCADA, COMPLETA_FORCADA_PEDIR_A_GESTOR, type ForcadaQueOPixCompleta } from '@/lib/conciliacao-status'
import { ForcadaDoPix } from './forcada-do-pix'
import { plural } from '@/lib/texto'
import type { VinculoPix } from '@/lib/pix-vinculo'

type Correspondencia = {
  tipo: VinculoPix['tipo'] | null
  vendaNf: string | null
  osNumero: number | null
  pedidoNumero: number | null
  pecaNumero: number | null
  lancadoPorNome: string | null
  lancadoEm: string | null
}

// `podeDesfazerForcada`: quem gere a conciliação (podeGerirConciliacao); a action confere de novo.
type Props = { id: string; correspondencia: Correspondencia; podeDesfazerForcada: boolean }

const labelPorTipo = {
  venda: (c: Correspondencia) => `NF ${c.vendaNf}`,
  os: (c: Correspondencia) => `OS #${c.osNumero}`,
  pedido: (c: Correspondencia) => `Pedido #${c.pedidoNumero}`,
  peca: (c: Correspondencia) => `PA #${c.pecaNumero}`,
}

/** Texto da correspondência já lançada (NF 123, OS #4...). */
export function rotuloCorrespondencia(c: Correspondencia) {
  return c.tipo ? labelPorTipo[c.tipo](c) : null
}

export type { Correspondencia }

export function CorrespondenciaForm({ id, correspondencia, podeDesfazerForcada }: Props) {
  const [pending, start] = useTransition()
  const [tipo, setTipo] = useState<VinculoPix['tipo']>('venda')
  const [numero, setNumero] = useState('')
  // O desvincular foi recusado porque o PIX completa uma forçada parcial (#92): o que a caixa mostra.
  const [forcada, setForcada] = useState<ForcadaQueOPixCompleta | null>(null)
  // Sem vínculo a caixa perde o sentido; ao religar, a recusa é que traz uma caixa nova.
  if (!correspondencia.tipo && forcada) setForcada(null)

  if (correspondencia.tipo) {
    const label = labelPorTipo[correspondencia.tipo](correspondencia)

    function remover() {
      start(async () => {
        try {
          const r = await removerCorrespondenciaAction(id)
          if (!r.ok && (r.erro === COMPLETA_FORCADA || r.erro === COMPLETA_FORCADA_PEDIR_A_GESTOR)) {
            const resumo = await forcadaDoPixAction(id)
            if (resumo.ok && resumo.dados) { setForcada(resumo.dados); return }
          }
          if (!r.ok) { toast.error(r.erro); return }
          toast.success('Correspondência desvinculada')
        } catch {
          // A recusa com frase já voltou em `r.erro`; aqui só cai falha interna, sem frase legível.
          toast.error('Erro ao desvincular')
        }
      })
    }

    const quemQuando = correspondencia.lancadoPorNome
      ? `${correspondencia.lancadoPorNome}${correspondencia.lancadoEm ? ` · ${new Date(correspondencia.lancadoEm).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}` : ''}`
      : null

    return (
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <span className="text-xs font-medium text-primary-text border-l-2 border-primary pl-2">
            {label}
          </span>
          {quemQuando && <p className="text-[11px] text-muted-foreground mt-0.5">{quemQuando}</p>}
        </div>
        {/* Botão com texto, não um X: no painel já existe um X no canto que fecha o card, e os dois se confundiam. */}
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={remover}
          disabled={pending}
          aria-label={`Desvincular ${label}`}
          className="ml-auto h-11 gap-1.5 border-destructive/30 text-base text-destructive hover:bg-destructive/10 hover:text-destructive md:h-8 md:text-xs"
        >
          <Unlink size={14} />
          {pending ? 'Desvinculando…' : 'Desvincular'}
        </Button>
        {forcada && <ForcadaDoPix id={id} rotulo={label} forcada={forcada} podeDesfazer={podeDesfazerForcada} onDesfeito={() => setForcada(null)} />}
      </div>
    )
  }

  function salvar() {
    if (!numero.trim()) return
    start(async () => {
      try {
        const r = await lancarCorrespondenciaAction(id, tipo, numero.trim())
        if (!r.ok) { toast.error(r.erro); return }
        // Ligado ao pedido com custo: as forçadas de PIX das vendas dele perderam o custo (#93, S2).
        const n = r.dados?.forcadasSemCusto ?? 0
        toast.success(n > 0
          ? `Correspondência lançada. O custo do PIX saiu de ${plural(n, 'forçada', 'forçadas')} deste pedido: agora ele entra por este PIX.`
          : 'Correspondência lançada')
        setNumero('')
      } catch {
        toast.error('Erro ao lançar correspondência')
      }
    })
  }

  return (
    <div className="flex items-center gap-1.5">
      <Select value={tipo} onValueChange={v => setTipo(v as VinculoPix['tipo'])}>
        <SelectTrigger className="h-11 w-24 text-base md:h-8 md:w-20 md:text-xs">
          <span>{{ venda: 'NF', os: 'OS', pedido: 'Pedido', peca: 'PA' }[tipo]}</span>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="venda">NF</SelectItem>
          <SelectItem value="os">OS</SelectItem>
          <SelectItem value="pedido">Pedido</SelectItem>
          <SelectItem value="peca">PA</SelectItem>
        </SelectContent>
      </Select>
      <Input
        value={numero}
        onChange={e => setNumero(e.target.value)}
        placeholder="Nº"
        className="h-11 w-20 text-base md:h-8 md:w-16 md:text-xs"
        inputMode="numeric"
      />
      <Button size="sm" className="h-11 text-base md:h-8 md:text-xs" disabled={pending || !numero.trim()} onClick={salvar}>
        {pending ? 'Salvando…' : 'Salvar'}
      </Button>
    </div>
  )
}
