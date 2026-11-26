'use client'
import { useTransition } from 'react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { inativarServicoAction, reativarServicoAction } from '../actions'

export function ServicoAtivoToggle({ id, ativo, podeGerir }: { id: string; ativo: boolean; podeGerir: boolean }) {
  const [pending, start] = useTransition()

  function toggle() {
    start(async () => {
      try {
        const resultado = ativo ? await inativarServicoAction(id) : await reativarServicoAction(id)
        if (!resultado.ok) toast.error(resultado.erro)
      } catch (e: unknown) {
        toast.error(e instanceof Error ? e.message : 'Erro ao atualizar status')
      }
    })
  }

  const selo = (
    <Badge variant={ativo ? 'default' : 'outline'}>
      {pending ? '...' : ativo ? 'Ativo' : 'Inativo'}
    </Badge>
  )
  if (!podeGerir) return selo

  return (
    <button onClick={toggle} disabled={pending} className="disabled:opacity-50" title={ativo ? 'Clique para inativar' : 'Clique para reativar'}>
      {selo}
    </button>
  )
}
