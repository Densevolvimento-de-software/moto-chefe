'use client'

import { cn } from '@/lib/utils'
import { rotuloDoStatus } from '@/lib/status-moto'
import { STATUS_NA_ENTRADA, type StatusNaEntrada } from '@/lib/entrada-motos-regras'

// Variante 2 do protótipo aprovado (#7): a pergunta é se as motos já chegaram à loja.
const OPCAO: Record<StatusNaEntrada, { resposta: string; marcada: string }> = {
  caixa: { resposta: 'Sim, estão na loja', marcada: 'border-primary bg-primary/10' },
  em_transporte: { resposta: 'Não, ainda estão no caminhão', marcada: 'border-info bg-info/10' },
}

/** Status de todas as motos do lançamento (#10): um campo só, para a nota inteira. */
export function StatusNaEntradaCampo({ valor, onChange, travado }: {
  valor: StatusNaEntrada
  onChange: (valor: StatusNaEntrada) => void
  travado: boolean
}) {
  return (
    <fieldset>
      <legend className="mb-1 text-sm text-muted-foreground">As motos desta nota já chegaram?</legend>
      <div className="grid gap-3 sm:grid-cols-2">
        {STATUS_NA_ENTRADA.map(status => (
          <label
            key={status}
            className={cn(
              'flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2.5 text-sm',
              valor === status ? OPCAO[status].marcada : 'border-border',
            )}
          >
            <input
              type="radio"
              name="status-na-entrada"
              value={status}
              checked={valor === status}
              onChange={() => onChange(status)}
              disabled={travado}
              className="mt-0.5 size-4 accent-primary"
            />
            <span>
              <span className="block font-medium">{OPCAO[status].resposta}</span>
              <span className="block text-xs text-muted-foreground">Entram como {rotuloDoStatus(status)}</span>
            </span>
          </label>
        ))}
      </div>
      {valor === 'em_transporte' && (
        <p className="mt-2 text-xs text-info">
          Todas as motos deste lançamento entram como Em transporte. Elas podem ser reservadas, mas não podem ser
          montadas, vendidas nem transferidas até alguém marcar a chegada.
        </p>
      )}
    </fieldset>
  )
}
