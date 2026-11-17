'use client'
import { useState } from 'react'
import { Bike, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { CurrencyInput } from '@/components/ui/currency-input'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { buscarPrecoMinimoAction, criarPedidoVendaAction } from '../actions'
import { podeCriarPedido } from '@/lib/pedido-venda-regras'
import { textoDaModalidade } from '@/lib/notagateway/transporte'
import { textoDaEntrega } from '@/lib/notagateway/entrega'
import { brl } from '@/lib/dashboard-painel'
import { centavos } from '@/lib/numero-br'
import { motosDoEnvio, totalDasMotos, type MotoDisponivel, type MotoNoPedido } from '@/lib/novo-pedido'
import { EntregaEModalidade, ENTREGA_DO_FORMULARIO_INICIAL, FreteCobrado, entregaDoFormulario, freteDoFormulario, quemRecebeInvalido, type EntregaDoFormulario } from './entrega-campos'
import { AdicionarMotoPainel } from './adicionar-moto-painel'

type Props = { motos: MotoDisponivel[]; papel: string }

/** Mínimo à vista de cada moto, só de referência (decisão do Luis, #24); 'erro' quando a busca falhou. */
type Minimos = Record<string, number | null | 'erro'>

/** Novo pedido no layout B da #682: itens à esquerda; Entrega, modalidade e resumo à direita. Várias motos (#24, V3). */
export function CriarPedidoDialog({ motos, papel }: Props) {
  const [open, setOpen] = useState(false)
  const [painel, setPainel] = useState(false)
  const [noPedido, setNoPedido] = useState<MotoNoPedido[]>([])
  const [minimos, setMinimos] = useState<Minimos>({})
  const [observacao, setObservacao] = useState('')
  const [entrega, setEntrega] = useState<EntregaDoFormulario>(ENTREGA_DO_FORMULARIO_INICIAL)
  const [loading, setLoading] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  function adicionar(novas: MotoDisponivel[]) {
    setNoPedido(atual => [...atual, ...novas.map(m => ({ ...m, valor: '' }))])
    for (const m of novas) {
      buscarPrecoMinimoAction(m.id)
        .then(info => setMinimos(atual => ({ ...atual, [m.id]: info?.valorMinimoPix ?? null })))
        .catch(() => setMinimos(atual => ({ ...atual, [m.id]: 'erro' })))
    }
  }
  const mudarValor = (id: string, valor: string) => setNoPedido(atual => atual.map(m => (m.id === id ? { ...m, valor } : m)))
  const tirar = (id: string) => setNoPedido(atual => atual.filter(m => m.id !== id))

  async function handleCriar() {
    const envio = motosDoEnvio(noPedido)
    if (!envio?.length) return
    setLoading(true)
    setErro(null)
    try {
      const r = await criarPedidoVendaAction(envio, observacao, entregaDoFormulario(entrega))
      // A recusa fica no diálogo, junto do que foi digitado, para corrigir sem redigitar (#848).
      if (!r.ok) { setErro(r.erro); return }
      setOpen(false)
      setNoPedido([])
      setObservacao('')
      setEntrega(ENTREGA_DO_FORMULARIO_INICIAL)
    } catch (e: any) {
      setErro(e.message)
    } finally {
      setLoading(false)
    }
  }

  if (!podeCriarPedido(papel)) return null

  const primeira = noPedido[0]
  const frete = freteDoFormulario(entrega)
  const envio = motosDoEnvio(noPedido)
  const total = centavos(totalDasMotos(noPedido) + frete)

  return (
    <>
      <Button onClick={() => { setErro(null); setOpen(true) }}>Criar Pedido de Venda</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>Novo pedido de venda</DialogTitle>
            <DialogDescription>{primeira ? primeira.lojaNome : 'Escolha a moto para ver a loja do pedido.'}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-6 md:grid-cols-[1.2fr_1fr]">
            <section className="space-y-4">
              <div className="flex items-baseline justify-between">
                <h3 className="text-sm font-semibold">Itens do pedido</h3>
                <span className="text-xs text-muted-foreground">{noPedido.length === 1 ? '1 moto' : `${noPedido.length} motos`}</span>
              </div>
              {noPedido.length > 0 && (
                <ul aria-label="Motos do pedido" className="divide-y divide-border rounded-lg border border-border">
                  {noPedido.map(m => (
                    <ItemMoto key={m.id} moto={m} minimo={minimos[m.id]} invalido={motosDoEnvio([m]) === null}
                      onValor={v => mudarValor(m.id, v)} onTirar={() => tirar(m.id)} />
                  ))}
                </ul>
              )}
              <Button variant="outline" className="h-11 border-dashed" onClick={() => setPainel(true)}>
                <Plus aria-hidden />Moto
              </Button>
              <div className="space-y-2">
                <Label htmlFor="pedido-observacao">Observação (opcional)</Label>
                <Textarea id="pedido-observacao" value={observacao} onChange={e => setObservacao(e.target.value)} />
              </div>
            </section>

            <section className="space-y-4 border-t border-border pt-4 md:border-t-0 md:border-l md:pt-0 md:pl-6">
              <EntregaEModalidade idModalidade="pedido-modalidade" valor={entrega} onChange={setEntrega} />
              <FreteCobrado id="pedido-frete" valor={entrega} onChange={setEntrega} />
              <div className="space-y-2">
                <h3 className="text-sm font-semibold">Resumo</h3>
                <div aria-label="Resumo do pedido" className="space-y-1 rounded-lg border border-border bg-muted p-3 text-sm">
                  <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
                    <dt className="text-muted-foreground">Motos ({noPedido.length})</dt>
                    <dd className="text-right">{brl(totalDasMotos(noPedido))}</dd>
                    <dt className="text-muted-foreground">Entrega</dt>
                    <dd className="text-right">{textoDaEntrega(entregaDoFormulario(entrega))}</dd>
                    <dt className="text-muted-foreground">Modalidade</dt>
                    <dd className="text-right">{textoDaModalidade(entrega.modalidade) ?? 'Não escolhida'}</dd>
                    {frete > 0 && (
                      <>
                        <dt className="text-muted-foreground">Frete</dt>
                        <dd className="text-right">{brl(frete)}</dd>
                      </>
                    )}
                  </dl>
                  <p className="flex justify-between border-t border-border pt-1 font-semibold"><span>Total</span><span>{brl(total)}</span></p>
                </div>
              </div>
            </section>
          </div>
          {erro && <p role="alert" className="text-sm text-destructive">{erro}</p>}
          <DialogFooter className="items-center sm:justify-between">
            <p className="text-sm text-muted-foreground">Total do pedido <strong className="block text-lg text-foreground">{brl(total)}</strong></p>
            <div className="flex gap-2">
              <Button variant="outline" className="h-11" onClick={() => setOpen(false)}>Cancelar</Button>
              <Button className="h-11" onClick={handleCriar} disabled={loading || !envio?.length || quemRecebeInvalido(entrega)}>
                {loading ? 'Criando...' : 'Criar pedido'}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <AdicionarMotoPainel aberto={painel} onAbertoChange={setPainel} disponiveis={motos} lojaId={primeira?.lojaId}
        noPedido={noPedido.map(m => m.id)} onAdicionar={adicionar} />
    </>
  )
}

function ItemMoto({ moto, minimo, invalido, onValor, onTirar }: {
  moto: MotoNoPedido; minimo: Minimos[string] | undefined; invalido: boolean; onValor: (v: string) => void; onTirar: () => void
}) {
  const nome = `${moto.marca} ${moto.modelo}`
  const idValor = `pedido-valor-${moto.id}`
  return (
    <li className="flex gap-3 p-3">
      <Bike className="mt-1 size-5 shrink-0 text-muted-foreground" aria-hidden />
      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="font-medium">{nome}</p>
            <p className="text-xs text-muted-foreground">Chassi final {moto.chassi.slice(-4)}, {moto.cor.toLowerCase()}</p>
          </div>
          <Button variant="ghost" size="icon" aria-label={`Tirar a ${nome} do pedido`} onClick={onTirar}><Trash2 aria-hidden /></Button>
        </div>
        <div className="flex items-end justify-between gap-3">
          <div className="space-y-1">
            <Label htmlFor={idValor}>Valor<span className="sr-only"> da {nome}</span></Label>
            <CurrencyInput id={idValor} className="h-11 w-36 text-right" placeholder="A definir" value={moto.valor} onChange={onValor} />
          </div>
          {minimo != null && (
            <p className="text-right text-xs text-muted-foreground">
              {minimo === 'erro' ? 'Não deu para ver o mínimo agora.' : <>Mínimo à vista <strong className="block text-sm text-foreground">{brl(minimo)}</strong></>}
            </p>
          )}
        </div>
        {invalido && <p className="text-xs text-destructive">Valor inválido</p>}
      </div>
    </li>
  )
}
