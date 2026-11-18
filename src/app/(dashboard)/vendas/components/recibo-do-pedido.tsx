'use client'
import { useState, type ReactNode } from 'react'
import { Bike, Check, Gift, Package, Pencil, TriangleAlert, Truck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { CurrencyInput } from '@/components/ui/currency-input'
import { brl } from '@/lib/dashboard-painel'
import { detalheDaMoto, type MotoNoPedido } from '@/lib/novo-pedido'
import type { PecaDoPedidoNaTela } from '@/lib/pedido-do-usuario'
import type { SeloDaMoto } from '@/lib/pedido-venda-regras'

type Props = {
  motos: readonly (MotoNoPedido & { minimo: number | null })[]
  pecas: readonly PecaDoPedidoNaTela[]
  /** Null até o pagamento fechar: antes disso o líquido ainda não é o da venda. */
  selos: readonly SeloDaMoto[] | null
  onValor: (motoId: string, valor: string) => void
  frete: number
  /** "Alterar" do frete: a Entrega do pedido. */
  acaoDoFrete: ReactNode
}

const unidades = (n: number) => (n === 1 ? '1 unidade' : `${n} unidades`)

/** Os itens do pedido como recibo (#25, V2): o valor da moto e o frete se ajustam aqui; brinde e acessório, no Editar pedido. */
export function ReciboDoPedido({ motos, pecas, selos, onValor, frete, acaoDoFrete }: Props) {
  const outros = pecas.length + (frete > 0 ? 1 : 0)
  return (
    <section aria-label="Itens do pedido" className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="font-medium">Itens do pedido</h3>
        <span className="text-xs text-muted-foreground">{motos.length === 1 ? '1 moto' : `${motos.length} motos`}{outros > 0 && `, ${outros} ${outros === 1 ? 'outro' : 'outros'}`}</span>
      </div>
      <ul className="divide-y divide-border rounded-lg border border-border">
        {motos.map(m => <LinhaDaMoto key={m.id} moto={m} selo={selos?.find(s => s.motoId === m.id)} onValor={v => onValor(m.id, v)} />)}
        {pecas.map(p => (
          <Linha key={`${p.tipo}-${p.pecaId}`} Icone={p.tipo === 'brinde' ? Gift : Package} titulo={p.nome}
            detalhe={p.tipo === 'brinde' ? 'Brinde, sem cobrança' : `Acessório, ${unidades(p.quantidade)}`} valor={brl(p.quantidade * Number(p.valor))} />
        ))}
        {frete > 0 && <Linha Icone={Truck} titulo="Frete" detalhe="Cobrado do cliente com a Entrega" valor={brl(frete)} acao={acaoDoFrete} />}
      </ul>
    </section>
  )
}

function Linha({ Icone, titulo, detalhe, valor, acao }: { Icone: typeof Bike; titulo: string; detalhe: string; valor: string; acao?: ReactNode }) {
  return (
    <li className="flex gap-3 p-3">
      <Icone className="mt-1 size-5 shrink-0 text-muted-foreground" aria-hidden />
      <div className="min-w-0 flex-1"><p className="font-medium">{titulo}</p><p className="text-xs text-muted-foreground">{detalhe}</p></div>
      <div className="flex flex-col items-end gap-1"><p className="font-semibold">{valor}</p>{acao}</div>
    </li>
  )
}

function LinhaDaMoto({ moto, selo, onValor }: { moto: Props['motos'][number]; selo: SeloDaMoto | undefined; onValor: (v: string) => void }) {
  // Moto sem valor (A definir no Novo pedido) já abre o campo.
  const [editando, setEditando] = useState(moto.valor === '')
  const nome = `${moto.marca} ${moto.modelo}`
  const abaixo = selo?.abaixo ?? false
  return (
    <li className={`flex gap-3 p-3 ${abaixo ? 'bg-warning/10' : ''}`}>
      <Bike className="mt-1 size-5 shrink-0 text-muted-foreground" aria-hidden />
      <div className="min-w-0 flex-1 space-y-2">
        <div>
          <p className="flex flex-wrap items-center gap-2 font-medium">
            {nome}
            {selo && (
              <span className={`inline-flex items-center gap-1 rounded-full px-2 text-xs ${abaixo ? 'bg-warning/15 text-warning' : 'bg-success/10 text-success'}`}>
                {abaixo ? <TriangleAlert className="size-3" aria-hidden /> : <Check className="size-3" aria-hidden />}{abaixo ? 'Abaixo do mínimo' : 'No mínimo'}
              </span>
            )}
          </p>
          <p className={`text-xs ${abaixo ? 'text-warning' : 'text-muted-foreground'}`}>
            {detalheDaMoto(moto)}{moto.minimo != null && `. Mínimo ${brl(moto.minimo)}`}{selo && `, líquido ${brl(selo.liquido)}`}
          </p>
        </div>
        {editando && <CurrencyInput aria-label={`Valor da ${nome}`} className="h-11 w-40" placeholder="0,00" value={moto.valor} onChange={onValor} />}
      </div>
      <div className="flex flex-col items-end gap-1">
        <p className="font-semibold">{moto.valor ? brl(Number(moto.valor)) : 'A definir'}</p>
        {!editando && (
          <Button variant="ghost" size="sm" className="text-primary-text" aria-label={`Alterar valor da ${nome}`} onClick={() => setEditando(true)}>
            <Pencil aria-hidden /> Alterar
          </Button>
        )}
      </div>
    </li>
  )
}
