'use client'
import { useState } from 'react'
import { Minus, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { CampoBusca } from '@/components/ui/campo-busca'
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { filtrarPecas } from '@/lib/busca-peca'
import { brl } from '@/lib/dashboard-painel'
import type { PecaComSaldo } from '@/lib/pecas-da-conta'
import type { PecaNoPedido } from '@/lib/novo-pedido'

type Marcada = { peca: PecaComSaldo; quantidade: number }
type Props = {
  tipo: PecaNoPedido['tipo'] | null
  onFechar: () => void
  /** Catálogo da loja do pedido; null enquanto carrega. */
  catalogo: PecaComSaldo[] | null
  erro: string | null
  lojaNome?: string
  onAdicionar: (tipo: PecaNoPedido['tipo'], marcadas: Marcada[]) => void
}

/** Painel lateral do Novo pedido (#24, V3): marca várias peças do catálogo da loja, cada uma com quantidade. */
export function AdicionarPecaPainel({ tipo, onFechar, catalogo, erro, lojaNome, onAdicionar }: Props) {
  const [busca, setBusca] = useState('')
  const [soComSaldo, setSoComSaldo] = useState(false)
  const [marcadas, setMarcadas] = useState<Marcada[]>([])
  const lista = filtrarPecas((catalogo ?? []).filter(p => !soComSaldo || p.quantidadeEstoque > 0), busca)

  const fechar = () => { setBusca(''); setMarcadas([]); onFechar() }
  const alternar = (peca: PecaComSaldo) => setMarcadas(atual =>
    (atual.some(m => m.peca.id === peca.id) ? atual.filter(m => m.peca.id !== peca.id) : [...atual, { peca, quantidade: 1 }]))
  const mudarQuantidade = (id: string, mais: number) =>
    setMarcadas(atual => atual.map(m => (m.peca.id === id ? { ...m, quantidade: Math.max(1, m.quantidade + mais) } : m)))
  const nomeDoTipo = tipo === 'brinde' ? 'brinde' : 'acessório'

  return (
    <Sheet open={tipo !== null} onOpenChange={aberto => { if (!aberto) fechar() }}>
      <SheetContent className="w-full gap-0 sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Adicionar {nomeDoTipo}</SheetTitle>
          <SheetDescription>{lojaNome ? `${lojaNome}. ` : ''}Marque quantas quiser.</SheetDescription>
        </SheetHeader>
        {/* Busca e filtro fixos no topo; só a lista rola (V3). */}
        <div className="flex flex-col gap-3 px-4 pb-3">
          <CampoBusca aria-label="Buscar peça" placeholder="Digite o nome da peça" value={busca} onChange={e => setBusca(e.target.value)} />
          <Button variant={soComSaldo ? 'secondary' : 'outline'} className="self-start rounded-full" aria-pressed={soComSaldo}
            onClick={() => setSoComSaldo(v => !v)}>Só com saldo na loja</Button>
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4">
          {erro
            ? <p role="alert" className="text-sm text-destructive">Não deu para carregar as peças: {erro}</p>
            : catalogo === null
              ? <p className="text-sm text-muted-foreground">Carregando as peças da loja...</p>
              : lista.length === 0
                ? <p className="text-sm text-muted-foreground">Nenhuma peça com esse nome.</p>
                : (
                  <ul className="divide-y divide-border rounded-lg border border-border">
                    {lista.map(p => {
                      const marcada = marcadas.find(m => m.peca.id === p.id)
                      const sobra = p.quantidadeEstoque - (marcada?.quantidade ?? 0)
                      return (
                        <li key={p.id} className={marcada ? 'bg-accent' : undefined}>
                          <label className="flex cursor-pointer items-start gap-3 p-3">
                            <input type="checkbox" className="mt-1 size-5 accent-primary" checked={!!marcada} onChange={() => alternar(p)} />
                            <div className="min-w-0 flex-1">
                              <span className="block font-medium">{p.nome}</span>
                              <span className={`block text-xs ${p.quantidadeEstoque <= 0 ? 'text-destructive' : 'text-muted-foreground'}`}>Saldo {p.quantidadeEstoque}</span>
                            </div>
                            <span className="text-sm">{brl(Number(p.valor))}</span>
                          </label>
                          {marcada && (
                            <div className="flex items-center gap-3 px-3 pb-3 pl-11">
                              <Quantidade nome={p.nome} valor={marcada.quantidade} onMudar={mais => mudarQuantidade(p.id, mais)} />
                              {sobra < 0 && <span className="text-xs text-warning">Fica em {sobra}; não trava</span>}
                            </div>
                          )}
                        </li>
                      )
                    })}
                  </ul>
                )}
          <p className="text-xs text-muted-foreground">Peças do catálogo da loja, com o preço do catálogo. Saldo zerado não impede a venda.</p>
        </div>
        <SheetFooter className="flex-row items-center justify-between border-t border-border">
          <span className="text-sm text-muted-foreground">{marcadas.length === 1 ? '1 peça marcada' : `${marcadas.length} peças marcadas`}</span>
          <Button className="h-11" disabled={marcadas.length === 0 || !tipo} onClick={() => { if (tipo) onAdicionar(tipo, marcadas); fechar() }}>
            Adicionar {marcadas.length === 1 ? '1 peça' : `${marcadas.length} peças`}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}

/** − quantidade + (mínimo 1), com nome acessível por peça. */
export function Quantidade({ nome, valor, onMudar }: { nome: string; valor: number; onMudar: (mais: number) => void }) {
  return (
    <div className="flex items-center rounded-lg border border-input">
      <Button variant="ghost" size="icon" className="size-10" aria-label={`Menos um ${nome}`} disabled={valor <= 1} onClick={() => onMudar(-1)}><Minus aria-hidden /></Button>
      <span className="w-8 text-center text-sm" aria-label={`Quantidade de ${nome}`}>{valor}</span>
      <Button variant="ghost" size="icon" className="size-10" aria-label={`Mais um ${nome}`} onClick={() => onMudar(1)}><Plus aria-hidden /></Button>
    </div>
  )
}
