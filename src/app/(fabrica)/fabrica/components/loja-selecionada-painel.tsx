// Loja selecionada (variante C): aparece só quando o filtro tem uma loja, na aba de vendas.
// Números do filtro atual: faturamento e motos vendidas, motos em estoque da loja.
import type { LojaPainel } from '@/lib/painel-fabrica'
import { fmtBRL } from '@/lib/preco-minimo'

const rotulo = 'text-xs text-muted-foreground'
const cartao = 'rounded-lg border bg-card p-4'

export function LojaSelecionadaPainel({ loja, faturamento, motos, emEstoque }: {
  loja: LojaPainel
  faturamento: number
  motos: number
  emEstoque: number
}) {
  return (
    <section aria-label="Loja selecionada" className="space-y-3">
      <div>
        <h2 className="text-lg font-semibold">Loja selecionada</h2>
        <p className="text-sm font-medium">{loja.lojaNome}</p>
      </div>
      <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className={cartao}>
          <dt className={rotulo}>Faturamento da loja</dt>
          <dd className="text-2xl font-bold tabular-nums">{fmtBRL(faturamento)}</dd>
        </div>
        <div className={cartao}>
          <dt className={rotulo}>Motos vendidas</dt>
          <dd className="text-2xl font-bold tabular-nums">{motos}</dd>
        </div>
        <div className={cartao}>
          <dt className={rotulo}>Motos em estoque</dt>
          <dd className="text-2xl font-bold tabular-nums">{emEstoque}</dd>
        </div>
      </dl>
    </section>
  )
}
