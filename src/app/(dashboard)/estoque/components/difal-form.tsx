'use client'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { EntradaDifal } from '@/lib/notagateway/difal'

type Props = {
  dados: EntradaDifal
  onChange: (atualizar: (anterior: EntradaDifal) => EntradaDifal) => void
}

/** Venda para outro estado, para quem não contribui com ICMS: a NF leva o DIFAL (#247). */
export function DifalForm({ dados, onChange }: Props) {
  const set = (campo: keyof EntradaDifal, valor: string) => onChange(anterior => ({ ...anterior, [campo]: valor }))
  return (
    <section className="space-y-4 rounded-lg border border-border bg-card p-4">
      <div>
        <h2 className="font-semibold">ICMS para outro estado (DIFAL)</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Venda para fora do estado, para quem não contribui com ICMS. Informe a alíquota interna do estado do comprador
          (a contabilidade confirma). A alíquota interestadual vem da regra fiscal do grupo.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="difal-aliquotaInterna">Alíquota interna do estado do comprador (%)</Label>
          <Input id="difal-aliquotaInterna" inputMode="decimal" placeholder="Ex.: 12" value={dados.aliquotaInterna} onChange={e => set('aliquotaInterna', e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="difal-fcp">FCP do estado do comprador (%), se houver</Label>
          <Input id="difal-fcp" inputMode="decimal" placeholder="0" value={dados.fcp} onChange={e => set('fcp', e.target.value)} />
        </div>
      </div>
    </section>
  )
}
