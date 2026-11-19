'use client'
import { useState, type ReactNode } from 'react'
import { Bike, Check, Gift, Lock, Package, Pencil, TriangleAlert, Truck } from 'lucide-react'
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
  /** Editar pedido efetivado com NF valendo (25d): moto e acessório estão na nota e não mudam. */
  travado?: boolean
  /** Quem não muda valor (o aux_adm no Editar efetivado) vê os valores sem "Alterar". */
  podeAlterarValor?: boolean
  /** Valor de cada unidade do acessório (Editar efetivado); sem ele, o acessório só mostra o valor, como no Efetivar. */
  onValorDaPeca?: (pecaId: string, valor: string) => void
}

/** O selo de item que está na NF valendo (Editar efetivado, 25d). */
export function NaNota() {
  return <span className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground"><Lock className="size-3.5" aria-hidden />Na nota</span>
}

const unidades = (n: number) => (n === 1 ? '1 unidade' : `${n} unidades`)

/**
 * Os itens do pedido como recibo (#25, V2): o valor da moto e o frete se ajustam aqui; brinde e acessório, no Editar pedido. No Editar
 * pedido efetivado (25d) o mesmo recibo trava o que está na nota, esconde o "Alterar" de quem não muda valor e abre o do acessório.
 */
export function ReciboDoPedido({ motos, pecas, selos, onValor, frete, acaoDoFrete, travado = false, podeAlterarValor = true, onValorDaPeca }: Props) {
  const outros = pecas.length + (frete > 0 ? 1 : 0)
  const estado: EstadoDoValor = travado ? 'na_nota' : podeAlterarValor ? 'alteravel' : 'fixo'
  return (
    <section aria-label="Itens do pedido" className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="font-medium">Itens do pedido</h3>
        <span className="text-xs text-muted-foreground">{motos.length === 1 ? '1 moto' : `${motos.length} motos`}{outros > 0 && `, ${outros} ${outros === 1 ? 'outro' : 'outros'}`}</span>
      </div>
      <ul className="divide-y divide-border rounded-lg border border-border">
        {motos.map(m => <LinhaDaMoto key={m.id} moto={m} selo={selos?.find(s => s.motoId === m.id)} estado={estado} onValor={v => onValor(m.id, v)} />)}
        {pecas.map(p => (p.tipo === 'acessorio' && onValorDaPeca
          ? <LinhaDoAcessorio key={`${p.tipo}-${p.pecaId}`} peca={p} estado={estado} onValor={v => onValorDaPeca(p.pecaId, v)} />
          : <Linha key={`${p.tipo}-${p.pecaId}`} Icone={p.tipo === 'brinde' ? Gift : Package} titulo={p.nome}
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

type EstadoDoValor = 'alteravel' | 'fixo' | 'na_nota'

/** "Alterar" abre o campo; na nota mostra o selo; fixo só o valor. Item sem valor (A definir) já abre o campo. */
function useValorDoItem(valor: string, estado: EstadoDoValor) {
  const [editando, setEditando] = useState(estado === 'alteravel' && valor === '')
  const abrir = estado === 'alteravel' && !editando ? () => setEditando(true) : null
  return { editando: estado === 'alteravel' && editando, abrir }
}

function AcaoDoValor({ estado, abrir, rotulo }: { estado: EstadoDoValor; abrir: (() => void) | null; rotulo: string }) {
  if (estado === 'na_nota') return <NaNota />
  if (!abrir) return null
  return (
    <Button variant="ghost" size="sm" className="text-primary-text" aria-label={rotulo} onClick={abrir}>
      <Pencil aria-hidden /> Alterar
    </Button>
  )
}

function LinhaDoAcessorio({ peca, estado, onValor }: { peca: PecaDoPedidoNaTela; estado: EstadoDoValor; onValor: (v: string) => void }) {
  const { editando, abrir } = useValorDoItem(peca.valor, estado)
  return (
    <li className="flex gap-3 p-3">
      <Package className="mt-1 size-5 shrink-0 text-muted-foreground" aria-hidden />
      <div className="min-w-0 flex-1 space-y-2">
        <div><p className="font-medium">{peca.nome}</p><p className="text-xs text-muted-foreground">Acessório, {unidades(peca.quantidade)}</p></div>
        {editando && <CurrencyInput aria-label={`Valor de cada ${peca.nome}`} className="h-11 w-40" placeholder="0,00" value={peca.valor} onChange={onValor} />}
      </div>
      <div className="flex flex-col items-end gap-1">
        <p className="font-semibold">{brl(peca.quantidade * Number(peca.valor))}</p>
        <AcaoDoValor estado={estado} abrir={abrir} rotulo={`Alterar valor do ${peca.nome}`} />
      </div>
    </li>
  )
}

function LinhaDaMoto({ moto, selo, estado, onValor }: { moto: Props['motos'][number]; selo: SeloDaMoto | undefined; estado: EstadoDoValor; onValor: (v: string) => void }) {
  const { editando, abrir } = useValorDoItem(moto.valor, estado)
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
        <AcaoDoValor estado={estado} abrir={abrir} rotulo={`Alterar valor da ${nome}`} />
      </div>
    </li>
  )
}
