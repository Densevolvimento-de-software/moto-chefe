'use client'

import { useEffect, useState } from 'react'
import { brl } from '@/lib/dashboard-painel'
import { custosDaVendaAction } from '../actions'

type Custos = { taxaCartao: number; tarifaPix: number; custoPix: number; liquido: number }

/**
 * Valor líquido nos Detalhes da venda (#93, variante B): os números vêm do servidor, pelas mesmas contas do
 * líquido e do DRE; aqui só se mostram. Cada custo em sublinha própria; sem custo nenhum, nada aparece.
 */
export function CustosDaVenda({ vendaId }: { vendaId: string }) {
  const [custos, setCustos] = useState<Custos | null>(null)

  useEffect(() => {
    let vivo = true
    custosDaVendaAction(vendaId).then(r => { if (vivo && r.ok) setCustos(r.dados) }, () => {})
    return () => { vivo = false }
  }, [vendaId])

  if (!custos) return null
  const sublinhas = ([['Taxa do cartão', custos.taxaCartao], ['Tarifa do PIX na maquininha', custos.tarifaPix], ['Custo do PIX', custos.custoPix]] as const)
    .filter(([, v]) => v > 0)
  if (sublinhas.length === 0) return null

  return (
    <div className="flex items-baseline justify-between gap-4 py-2.5">
      <span className="shrink-0 text-muted-foreground">Valor líquido</span>
      <div className="min-w-0 text-right">
        <b className="tabular-nums">{brl(custos.liquido)}</b>
        {sublinhas.map(([rotulo, valor]) => (
          <p key={rotulo} data-sublinha className="mt-0.5 flex justify-end gap-3 text-xs text-muted-foreground">
            <span>{rotulo}</span>
            <span className="tabular-nums">{brl(valor)}</span>
          </p>
        ))}
      </div>
    </div>
  )
}
