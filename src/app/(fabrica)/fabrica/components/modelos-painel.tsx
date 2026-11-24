// Vendas e estoque por modelo (variante C): uma tabela no computador e uma lista de cartões no celular.
// Os números vêm de resumirModelos (src/lib/painel-fabrica.ts), no mesmo filtro da lista de baixo.
import type { ModeloPainel } from '@/lib/painel-fabrica'
import { fmtBRL } from '@/lib/preco-minimo'

const th = 'px-3 py-2 text-xs font-medium text-muted-foreground'
const td = 'px-3 py-2 tabular-nums'
const n = (v: number) => v.toLocaleString('pt-BR')

export function ModelosPainel({ modelos }: { modelos: ModeloPainel[] }) {
  return (
    <section aria-label="Vendas e estoque por modelo" className="space-y-3">
      <h2 className="text-lg font-semibold">Vendas e estoque por modelo</h2>
      {modelos.length === 0 ? (
        <p className="rounded-lg border bg-card p-4 text-sm text-muted-foreground">
          Nenhum modelo com venda ou estoque com estes filtros.
        </p>
      ) : (
        <>
          <div className="hidden overflow-x-auto rounded-lg border bg-card md:block">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted">
                <tr>
                  <th className={`${th} text-left`}>Modelo</th>
                  <th className={`${th} text-right`}>Vendidas</th>
                  <th className={`${th} text-right`}>Receita</th>
                  <th className={`${th} text-right`}>Preço médio</th>
                  <th className={`${th} text-right`}>Em estoque</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {modelos.map(m => (
                  <tr key={m.modelo}>
                    <td className={`${td} font-medium`}>{m.modelo}</td>
                    <td className={`${td} text-right`}>{n(m.vendidas)}</td>
                    <td className={`${td} text-right`}>{fmtBRL(m.receita)}</td>
                    <td className={`${td} text-right`}>{fmtBRL(m.precoMedio)}</td>
                    <td className={`${td} text-right`}>{n(m.emEstoque)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="space-y-2 md:hidden">
            {modelos.map(m => (
              <li key={m.modelo} className="rounded-lg border bg-card p-4">
                <p className="font-semibold">{m.modelo}</p>
                <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                  <dt className="text-muted-foreground">Vendidas</dt><dd className="text-right tabular-nums">{n(m.vendidas)}</dd>
                  <dt className="text-muted-foreground">Receita</dt><dd className="text-right tabular-nums">{fmtBRL(m.receita)}</dd>
                  <dt className="text-muted-foreground">Preço médio</dt><dd className="text-right tabular-nums">{fmtBRL(m.precoMedio)}</dd>
                  <dt className="text-muted-foreground">Em estoque</dt><dd className="text-right tabular-nums">{n(m.emEstoque)}</dd>
                </dl>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  )
}
