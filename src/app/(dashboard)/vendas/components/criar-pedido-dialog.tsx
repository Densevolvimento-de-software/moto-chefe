'use client'
import { useEffect, useState } from 'react'
import { Bike, Gift, Package, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { CurrencyInput } from '@/components/ui/currency-input'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { buscarPrecoMinimoAction, criarPedidoVendaAction, pecasDaLojaParaPedidoAction } from '../actions'
import { podeGerirPecas } from '../../pecas/papeis'
import { podeCriarPedido } from '@/lib/pedido-venda-regras'
import { textoDaModalidade } from '@/lib/notagateway/transporte'
import { textoDaEntrega } from '@/lib/notagateway/entrega'
import { brl } from '@/lib/dashboard-painel'
import { centavos } from '@/lib/numero-br'
import { avisoDeSaldo, comPecas, detalheDaMoto, motosDoEnvio, motosSemValor, pecasDoEnvio, totalDasMotos, totalDasPecasNaTela, type MotoDisponivel, type MotoNoPedido, type PecaNoPedido } from '@/lib/novo-pedido'
import type { PecaComSaldo } from '@/lib/pecas-da-conta'
import { EntregaEModalidade, ENTREGA_DO_FORMULARIO_INICIAL, FreteCobrado, entregaDoFormulario, freteDoFormulario, quemRecebeInvalido, type EntregaDoFormulario } from './entrega-campos'
import { AdicionarMotoPainel } from './adicionar-moto-painel'
import { AdicionarPecaPainel, Quantidade } from './adicionar-peca-painel'
import { ItensNoCelular } from './itens-no-celular'
import { useIsDesktop } from '@/hooks/use-is-desktop'

type Props = { motos: MotoDisponivel[]; papel: string }

/** Mínimo à vista de cada moto, só de referência (decisão do Luis, #24); 'erro' quando a busca falhou. */
type Minimos = Record<string, number | null | 'erro'>

/** Novo pedido no layout B da #682: itens à esquerda; Entrega, modalidade e resumo à direita. Várias motos (#24, V3). */
export function CriarPedidoDialog({ motos, papel }: Props) {
  const [open, setOpen] = useState(false)
  const desktop = useIsDesktop()
  const [painel, setPainel] = useState(false)
  const [noPedido, setNoPedido] = useState<MotoNoPedido[]>([])
  const [minimos, setMinimos] = useState<Minimos>({})
  const [pecas, setPecas] = useState<PecaNoPedido[]>([])
  const [painelPeca, setPainelPeca] = useState<PecaNoPedido['tipo'] | null>(null)
  const [catalogo, setCatalogo] = useState<{ lista: PecaComSaldo[] | null; erro: string | null }>({ lista: null, erro: null })
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
  // O catálogo e o saldo são os da loja do pedido, a da 1ª moto (decisão 4 do Luis, #24).
  const lojaDoPedido = noPedido[0]?.lojaId
  useEffect(() => {
    if (!lojaDoPedido) return
    let vivo = true
    setCatalogo({ lista: null, erro: null })
    pecasDaLojaParaPedidoAction(lojaDoPedido)
      .then(r => {
        if (!vivo) return
        setCatalogo(r.ok ? { lista: r.dados, erro: null } : { lista: null, erro: r.erro })
        // Outra 1ª moto pode ser de outra loja: as peças já escolhidas passam a mostrar o saldo dela.
        if (r.ok) setPecas(atual => atual.map(p => ({ ...p, peca: r.dados.find(x => x.id === p.peca.id) ?? p.peca })))
      })
      .catch(() => { if (vivo) setCatalogo({ lista: null, erro: 'tente de novo em instantes' }) })
    return () => { vivo = false }
  }, [lojaDoPedido])
  const mudarPeca = (i: number, muda: (p: PecaNoPedido) => Partial<PecaNoPedido>) => setPecas(atual => atual.map((p, j) => (j === i ? { ...p, ...muda(p) } : p)))
  const mudarValor = (id: string, valor: string) => setNoPedido(atual => atual.map(m => (m.id === id ? { ...m, valor } : m)))
  const tirar = (id: string) => setNoPedido(atual => atual.filter(m => m.id !== id))

  async function handleCriar() {
    const envio = motosDoEnvio(noPedido)
    const envioPecas = pecasDoEnvio(pecas, podeGerirPecas(papel))
    if (!envio?.length || !envioPecas) return
    setLoading(true)
    setErro(null)
    try {
      const r = pecas.length > 0
        ? await criarPedidoVendaAction(envio, observacao, entregaDoFormulario(entrega), envioPecas)
        : await criarPedidoVendaAction(envio, observacao, entregaDoFormulario(entrega))
      // A recusa fica no diálogo, junto do que foi digitado, para corrigir sem redigitar (#848).
      if (!r.ok) { setErro(r.erro); return }
      setOpen(false)
      setNoPedido([])
      setPecas([])
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
  const envioPecas = pecasDoEnvio(pecas, podeGerirPecas(papel))
  const total = centavos(totalDasMotos(noPedido) + totalDasPecasNaTela(pecas) + frete)
  const qtd = (tipo: PecaNoPedido['tipo']) => pecas.filter(p => p.tipo === tipo).reduce((n, p) => n + p.quantidade, 0)
  const semValor = motosSemValor(noPedido)
  const itemMoto = (m: MotoNoPedido) => (
    <ItemMoto key={m.id} moto={m} minimo={minimos[m.id]} invalido={motosDoEnvio([m]) === null}
      onValor={v => mudarValor(m.id, v)} onTirar={() => tirar(m.id)} />
  )
  const itemPeca = (p: PecaNoPedido, i: number) => (
    <ItemPeca key={`${p.tipo}-${p.peca.id}`} item={p} aviso={avisoDeSaldo(pecas, p.peca.id)} ajustaPreco={podeGerirPecas(papel)}
      onQuantidade={mais => mudarPeca(i, atual => ({ quantidade: Math.max(1, atual.quantidade + mais) }))}
      onValor={valor => mudarPeca(i, () => ({ valor }))} onTirar={() => setPecas(atual => atual.filter((_, j) => j !== i))} />
  )

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
            <section aria-label="Itens do pedido" className="space-y-4">
              <div className="flex items-baseline justify-between">
                <h3 className="text-sm font-semibold">Itens do pedido</h3>
                <span className="text-xs text-muted-foreground">{noPedido.length === 1 ? '1 moto' : `${noPedido.length} motos`}</span>
              </div>
              {/* Celular (#24, N3): blocos do próprio pedido com a busca embutida; desktop: lista e painel lateral (V3). */}
              {!desktop ? (
                <ItensNoCelular disponiveis={motos} noPedido={noPedido} pecas={pecas} catalogo={catalogo} moto={itemMoto} peca={itemPeca}
                  onPorMoto={m => adicionar([m])} onPorPeca={(tipo, peca) => setPecas(atual => comPecas(atual, tipo, [{ peca, quantidade: 1 }]))} />
              ) : (<>
                {noPedido.length > 0 && <ul aria-label="Motos do pedido" className="divide-y divide-border rounded-lg border border-border">{noPedido.map(itemMoto)}</ul>}
                {pecas.length > 0 && <ul aria-label="Peças do pedido" className="divide-y divide-border rounded-lg border border-border">{pecas.map(itemPeca)}</ul>}
                <div className="flex flex-wrap items-center gap-2">
                  <Button variant="outline" className="h-11 border-dashed" onClick={() => setPainel(true)}><Plus aria-hidden />Moto</Button>
                  <Button variant="outline" className="h-11 border-dashed" disabled={!primeira} onClick={() => setPainelPeca('brinde')}><Plus aria-hidden />Brinde</Button>
                  <Button variant="outline" className="h-11 border-dashed" disabled={!primeira} onClick={() => setPainelPeca('acessorio')}><Plus aria-hidden />Acessório</Button>
                  {!primeira && <span className="text-xs text-muted-foreground">Escolha a moto primeiro</span>}
                </div>
              </>)}
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
                    {semValor && <><dt className="sr-only">Motos sem valor</dt><dd className="col-span-2 text-right text-xs text-warning">{semValor}</dd></>}
                    {qtd('acessorio') > 0 && <><dt className="text-muted-foreground">Acessórios ({qtd('acessorio')})</dt><dd className="text-right">{brl(totalDasPecasNaTela(pecas))}</dd></>}
                    {qtd('brinde') > 0 && <><dt className="text-muted-foreground">Brindes ({qtd('brinde')})</dt><dd className="text-right">Sem cobrança</dd></>}
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
          {/* No celular o total e "Criar pedido" ficam fixos embaixo (N3). */}
          <DialogFooter className="flex-col items-stretch max-lg:sticky max-lg:-bottom-4 max-lg:z-10 max-lg:bg-popover sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-muted-foreground">Total do pedido <strong className="block text-lg text-foreground">{brl(total)}</strong></p>
            <div className="grid grid-cols-2 gap-2 sm:flex">
              <Button variant="outline" className="h-11" onClick={() => setOpen(false)}>Cancelar</Button>
              <Button className="h-11" onClick={handleCriar} disabled={loading || !envio?.length || !envioPecas || quemRecebeInvalido(entrega)}>
                {loading ? 'Criando...' : 'Criar pedido'}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <AdicionarMotoPainel aberto={painel} onAbertoChange={setPainel} disponiveis={motos} lojaId={primeira?.lojaId}
        noPedido={noPedido.map(m => m.id)} onAdicionar={adicionar} />
      <AdicionarPecaPainel tipo={painelPeca} onFechar={() => setPainelPeca(null)} catalogo={catalogo.lista} erro={catalogo.erro}
        lojaNome={primeira?.lojaNome} onAdicionar={(tipo, marcadas) => setPecas(atual => comPecas(atual, tipo, marcadas))} />
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
            <p className="text-xs text-muted-foreground">{detalheDaMoto(moto)}</p>
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

function ItemPeca({ item, aviso, ajustaPreco, onQuantidade, onValor, onTirar }: {
  item: PecaNoPedido; aviso: string | null; ajustaPreco: boolean; onQuantidade: (mais: number) => void; onValor: (v: string) => void; onTirar: () => void
}) {
  const { peca, tipo } = item
  const idValor = `pedido-${tipo}-${peca.id}`
  const doCatalogo = brl(Number(peca.valor))
  const Icone = tipo === 'brinde' ? Gift : Package
  return (
    <li className="flex gap-3 p-3">
      <Icone className="mt-1 size-5 shrink-0 text-muted-foreground" aria-hidden />
      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="font-medium">{peca.nome}</p>
            <p className="text-xs text-muted-foreground">{tipo === 'brinde' ? 'Brinde' : 'Acessório'}</p>
            {aviso && <p className="text-xs text-warning">{aviso}</p>}
          </div>
          <Button variant="ghost" size="icon" aria-label={`Tirar ${peca.nome} do pedido`} onClick={onTirar}><Trash2 aria-hidden /></Button>
        </div>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <Quantidade nome={peca.nome} valor={item.quantidade} onMudar={onQuantidade} />
          {/* Decisões 2 e 3 do Luis (#24): só quem gere peças ajusta o preço; o brinde mostra o catálogo só de referência. */}
          {tipo === 'brinde'
            ? <p className="text-sm text-muted-foreground">Sem cobrança (catálogo {doCatalogo})</p>
            : ajustaPreco
              ? (
                <div className="space-y-1">
                  <Label htmlFor={idValor}>Valor de cada<span className="sr-only"> {peca.nome}</span></Label>
                  <CurrencyInput id={idValor} className="h-11 w-32 text-right" placeholder={doCatalogo} value={item.valor} onChange={onValor} />
                </div>
              )
              : <p className="text-sm">{doCatalogo} cada</p>}
        </div>
        {tipo === 'acessorio' && <p className="text-right text-xs text-muted-foreground">Subtotal <strong className="text-sm text-foreground">{brl(totalDasPecasNaTela([item]))}</strong></p>}
      </div>
    </li>
  )
}
