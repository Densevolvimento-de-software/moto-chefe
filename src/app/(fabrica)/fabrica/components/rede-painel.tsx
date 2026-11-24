// Rede no topo do painel (variante C): faturamento e motos do filtro, lojas com venda nele e média por essas lojas.
// Os números vêm de resumirRede (src/lib/painel-fabrica.ts). Só o que o painel já lê: sem meta, oficina ou DRE.
import type { RedePainel as Rede } from '@/lib/painel-fabrica'
import { fmtBRL } from '@/lib/preco-minimo'

const rotulo = 'text-xs text-muted-foreground'
const numero = 'text-lg font-semibold tabular-nums'
const cartao = 'rounded-lg border bg-card p-4'

export function RedePainel({ rede, periodo }: { rede: Rede; periodo: string }) {
  return (
    <section aria-label="Rede" className="space-y-3">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-[2fr_1fr]">
        <div className={cartao}>
          <p className={rotulo}>Faturamento das motos</p>
          <p className="text-3xl font-bold tabular-nums">{fmtBRL(rede.valor)}</p>
          <p className="mt-1 text-xs text-muted-foreground">{periodo}</p>
        </div>
        <div className={cartao}>
          <p className={rotulo}>Motos vendidas</p>
          <p className="text-3xl font-bold tabular-nums">{rede.motos}</p>
        </div>
      </div>
      <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className={cartao}>
          <dt className={rotulo}>Lojas com venda</dt>
          <dd className={numero}>{rede.lojasComVenda}</dd>
        </div>
        <div className={cartao}>
          <dt className={rotulo}>Faturamento médio por loja com venda</dt>
          <dd className={numero}>{fmtBRL(rede.mediaPorLoja)}</dd>
        </div>
      </dl>
    </section>
  )
}
