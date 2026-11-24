// Rede no topo do painel (variante C): faturamento e motos do filtro, lojas da lista e média por loja.
// Os números vêm de resumirRede (src/lib/painel-fabrica.ts). Só o que o painel já lê: sem meta, oficina ou DRE.
import type { RedePainel as Rede } from '@/lib/painel-fabrica'
import { fmtBRL } from '@/lib/preco-minimo'
import { plural } from '@/lib/texto'

const rotulo = 'text-xs text-muted-foreground'
const numero = 'text-lg font-semibold tabular-nums'

export function RedePainel({ rede, periodo }: { rede: Rede; periodo: string }) {
  return (
    <section aria-label="Rede" className="bg-card border rounded-lg p-4 md:p-5 space-y-4">
      <div className="flex flex-col gap-1 md:flex-row md:items-end md:justify-between">
        <div>
          <p className={rotulo}>Faturamento das motos</p>
          <p className="text-3xl font-bold tabular-nums">{fmtBRL(rede.valor)}</p>
        </div>
        <p className="text-sm text-muted-foreground">
          {plural(rede.motos, 'moto', 'motos')} {rede.motos === 1 ? 'vendida' : 'vendidas'} · {periodo}
        </p>
      </div>
      <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="rounded-md bg-muted/50 px-3 py-2">
          <dt className={rotulo}>Lojas na rede</dt>
          <dd className={numero}>{rede.lojas}</dd>
        </div>
        <div className="rounded-md bg-muted/50 px-3 py-2">
          <dt className={rotulo}>Faturamento médio por loja</dt>
          <dd className={numero}>{fmtBRL(rede.valorPorLoja)}</dd>
        </div>
      </dl>
    </section>
  )
}
