'use client'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { alterarEntregaDoPedidoAction, efetivarVendaAction, itensDoPedidoAction } from '../actions'
import { AlterarEntregaDialog } from './alterar-entrega-dialog'
import { ResumoDaEntrega } from './resumo-da-entrega'
import { ReciboDoPedido } from './recibo-do-pedido'
import { PagamentosFields, pagamentosDoFormulario, pgtoHandlers, pgtoIncompleto, type Pgto } from '@/app/(dashboard)/estoque/components/pagamentos-fields'
import { useMaquininhas } from '@/components/use-maquininhas'
import { aprovacaoDoPedido, foraDaMoto, totalDoPedido, type MotoComValor } from '@/lib/pedido-venda-regras'
import { motosDoEnvio, totalDasMotos } from '@/lib/novo-pedido'
import { pagamentosIncompletos, situacaoDoPagamento } from '@/lib/pagamentos-entrada'
import { OrigemVendaSelect, origemPreenchida } from '@/components/origem-venda-select'
import type { OrigemParaEscolher } from '@/lib/queries/origens-venda'
import { ClienteBusca } from '@/app/(dashboard)/clientes/components/cliente-busca'
import { lerDocumentoCliente, mascararCpfCnpj, tipoPessoaSeCompleto } from '@/lib/documento'
import { DocumentoClienteInput } from '@/components/documento-cliente'
import { freteDaVenda, type EntregaVenda } from '@/lib/notagateway/entrega'
import { brl } from '@/lib/dashboard-painel'
import { motivoDaAprovacao, temPagamentoSensivel } from '@/lib/aprovacao-venda'
import { liquidoDaMoto } from '@/lib/preco-minimo'

type Props = {
  pedidoId: string; numero: number; origens: OrigemParaEscolher[]
  papel: string
  /** Quem tem a permissão efetiva transferência direto; os demais pedem aprovação (#776). */
  podeAprovarSensivel: boolean
  /** Vem do pedido e vai para a venda no servidor; "Alterar" muda a do pedido (#895). */
  entrega: EntregaVenda | null
}
type Itens = Extract<Awaited<ReturnType<typeof itensDoPedidoAction>>, { ok: true }>['dados']

const PGTO_VAZIO: Pgto = { id: '1', tipo: '', valor: '' }

/**
 * Efetivar o pedido (#25, V2 aprovado pelo Luis): os itens vêm do pedido como recibo; o cliente e as formas de pagamento se
 * digitam aqui. Selo, barra e aprovação saem das funções do servidor. No celular, uma coluna com os itens primeiro.
 */
export function EfetivarPedidoDialog({ pedidoId, numero, origens, entrega: entregaDoPedido, papel, podeAprovarSensivel }: Props) {
  const [open, setOpen] = useState(false)
  // O "Alterar" grava no pedido; o total e a tela seguem a nova sem esperar a página recarregar.
  const [entrega, setEntrega] = useState(entregaDoPedido)
  // A página recarregada (outra aba, aprovação) traz o pedido de novo: a tela acompanha.
  useEffect(() => setEntrega(entregaDoPedido), [entregaDoPedido])
  const [itens, setItens] = useState<{ dados: Itens | null; erro: string | null }>({ dados: null, erro: null })
  const [valores, setValores] = useState<Record<string, string>>({})
  const [clienteId, setClienteId] = useState<string | null>(null)
  const [clienteSelecionado, setClienteSelecionado] = useState<{ id: string; nome: string } | null>(null)
  const [clienteNome, setClienteNome] = useState('')
  const [clienteCpf, setClienteCpf] = useState('')
  const [pgtos, setPgtos] = useState<Pgto[]>([PGTO_VAZIO])
  const pgto = pgtoHandlers(setPgtos)
  const [origemId, setOrigemId] = useState('')
  const [origemDetalhe, setOrigemDetalhe] = useState('')
  const [motivo, setMotivo] = useState('')
  const [loading, setLoading] = useState(false)
  const lojaId = itens.dados?.lojaId
  const maquininhas = useMaquininhas(lojaId ? { loja: lojaId } : null)

  useEffect(() => {
    if (!open) return
    let vivo = true
    setItens({ dados: null, erro: null })
    itensDoPedidoAction(pedidoId)
      .then(r => {
        if (!vivo) return
        setItens(r.ok ? { dados: r.dados, erro: null } : { dados: null, erro: r.erro })
        if (r.ok) setValores(Object.fromEntries(r.dados.motos.map(m => [m.id, m.valor])))
      })
      .catch(() => { if (vivo) setItens({ dados: null, erro: 'tente de novo em instantes.' }) })
    return () => { vivo = false }
  }, [open, pedidoId])

  const motos = (itens.dados?.motos ?? []).map(m => ({ ...m, valor: valores[m.id] ?? m.valor }))
  const pecas = (itens.dados?.pecas ?? []).map(p => ({ quantidade: p.quantidade, valorUnitario: p.valor }))
  const envio = motosDoEnvio(motos)
  // Na efetivação toda moto tem valor; "A definir" trava o botão.
  const motosComValor = envio && envio.length > 0 && envio.every(m => m.valor !== undefined) ? (envio as MotoComValor[]) : null
  const total = totalDoPedido(totalDasMotos(motos), entrega, pecas)
  const pagamentos = pagamentosDoFormulario(pgtos)
  const situacao = situacaoDoPagamento(pagamentos, total)
  const taxas = itens.dados?.taxas ?? null
  // Antes de fechar o pagamento o líquido é parcial: sem selo nem aviso de mínimo.
  const aprovacao = motosComValor && situacao.tipo === 'pago' ? aprovacaoDoPedido({
    sensivelSemPermissao: temPagamentoSensivel(pagamentos) && !podeAprovarSensivel,
    papel,
    liquido: taxas ? liquidoDaMoto(pagamentos, taxas, foraDaMoto(entrega, pecas)) : 0,
    motos: motosComValor.map(m => ({ ...m, minimo: motos.find(x => x.id === m.motoId)?.minimo ?? null })),
  }) : null
  const juridica = tipoPessoaSeCompleto(clienteCpf) === 'juridica'
  const podeEfetivar = !!motosComValor && !!clienteNome && lerDocumentoCliente(clienteCpf).ok
    && origemPreenchida(origens, origemId, origemDetalhe) && situacao.tipo === 'pago' && !pagamentosIncompletos(pagamentos)
    && !pgtos.some(p => pgtoIncompleto(p, taxas, maquininhas)) && (!aprovacao?.tipo || !!motivoDaAprovacao(aprovacao.tipo, motivo))

  function escolherCliente(id: string, nome: string, cpfCnpj: string | null) {
    setClienteId(id)
    setClienteSelecionado({ id, nome })
    setClienteNome(nome)
    setClienteCpf(mascararCpfCnpj(cpfCnpj ?? ''))
  }

  function limparCliente() {
    setClienteId(null)
    setClienteSelecionado(null)
    setClienteNome('')
    setClienteCpf('')
  }

  async function efetivar() {
    if (!podeEfetivar || !motosComValor) return
    setLoading(true)
    try {
      const r = await efetivarVendaAction(
        pedidoId, clienteNome, clienteCpf, motosComValor, pagamentos, clienteId ?? undefined,
        origemId, origemDetalhe.trim() || undefined, motivo.trim() || undefined,
      )
      if (!r.ok) { toast.error(r.erro); return }
      if (r.dados) toast.success('Pedido enviado para aprovação')
      setOpen(false)
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Não deu para efetivar agora. Tente de novo.')
    } finally {
      setLoading(false)
    }
  }

  const alterarEntrega = <AlterarEntregaDialog entrega={entrega} freteFixo={false} rotulo="Alterar"
    salvar={nova => alterarEntregaDoPedidoAction(pedidoId, nova)} aoSalvar={setEntrega} />
  const nomeDaMoto = (motoId: string) => { const m = motos.find(x => x.id === motoId); return m ? `${m.marca} ${m.modelo}` : '' }
  const textoDaSituacao = { falta: `Falta pagar ${brl(situacao.diferenca)}`, pago: 'Pago por completo', passou: `Passou ${brl(situacao.diferenca)} do total` }[situacao.tipo]

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>Efetivar Venda</Button>
      {/* Ação sem volta: enquanto grava, nada fecha o diálogo. */}
      <Dialog open={open} onOpenChange={o => { if (!loading) setOpen(o) }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-5xl">
          <DialogHeader>
            <DialogTitle>Efetivar pedido {numero}</DialogTitle>
            <DialogDescription>Os itens vêm do pedido. Falta o cliente e o pagamento.{motos[0] && ` ${motos[0].lojaNome}.`}</DialogDescription>
          </DialogHeader>
          {/* O recibo vem antes no DOM: no celular ele fica em cima; no desktop vai para a coluna da direita. */}
          <div className="grid gap-6 lg:grid-cols-2">
            <div className="space-y-3 lg:order-2">
              {itens.erro
                ? <p role="alert" className="text-sm text-destructive">Não deu para carregar os itens do pedido: {itens.erro}</p>
                : !itens.dados
                  ? <p className="text-sm text-muted-foreground">Carregando os itens do pedido...</p>
                  : <ReciboDoPedido motos={motos} pecas={itens.dados.pecas} selos={aprovacao?.porMoto ?? null} frete={freteDaVenda(entrega)}
                      onValor={(id, v) => setValores(atual => ({ ...atual, [id]: v }))} acaoDoFrete={alterarEntrega} />}
              <ResumoDaEntrega rotulo="Entrega do pedido" entrega={entrega} sufixo="(do pedido)"
                semEntrega={<p className="text-muted-foreground">Pedido sem a Entrega informada.</p>}
                acao={alterarEntrega} />
            </div>
            <div className="space-y-4 lg:order-1">
              <section className="space-y-2">
                <h3 className="font-medium">Cliente</h3>
                <Label>Buscar no cadastro</Label>
                <ClienteBusca onSelect={escolherCliente} clienteSelecionado={clienteSelecionado} onClear={limparCliente} />
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label>{juridica ? 'Razão social' : 'Nome completo'}</Label>
                    <Input value={clienteNome} onChange={e => setClienteNome(e.target.value)} placeholder={juridica ? 'Razão social da empresa' : 'Nome completo'} />
                  </div>
                  <div className="space-y-1">
                    <Label>CPF/CNPJ</Label>
                    <DocumentoClienteInput value={clienteCpf} onChange={setClienteCpf} />
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">O mesmo cliente para todas as motos do pedido.</p>
              </section>
              <OrigemVendaSelect origens={origens} origemId={origemId} onOrigemChange={setOrigemId} detalhe={origemDetalhe} onDetalheChange={setOrigemDetalhe} />
              <section aria-label="Pagamento do pedido" className="space-y-2">
                <h3 className="font-medium">Pagamento do pedido</h3>
                <PagamentosFields pgtos={pgtos} onAdd={pgto.add} onRemove={pgto.remove} onUpdate={pgto.update} taxasVenda={taxas} maquininhas={maquininhas} />
                <div className="space-y-2 rounded-lg bg-muted p-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className={`font-medium ${situacao.tipo === 'passou' ? 'text-destructive' : situacao.tipo === 'pago' ? 'text-primary-text' : ''}`}>{textoDaSituacao}</span>
                    <span className="text-xs text-muted-foreground">{brl(situacao.pago)} de {brl(total)}</span>
                  </div>
                  <div className="h-2 rounded-full bg-border">
                    <div className={`h-2 rounded-full ${situacao.tipo === 'passou' ? 'bg-destructive' : 'bg-primary'}`}
                      style={{ width: `${total > 0 ? Math.min(100, (situacao.pago / total) * 100) : 0}%` }} />
                  </div>
                </div>
              </section>
              {aprovacao?.tipo && (
                <div className="space-y-2">
                  <div role="status" className="space-y-1 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning">
                    <p><strong>O pedido inteiro vai para aprovação.</strong> {aprovacao.tipo === 'valor_minimo'
                      ? 'As motos ficam aguardando até alguém aprovar.' : 'Transferência bancária precisa de aprovação.'}</p>
                    {aprovacao.tipo === 'valor_minimo' && (
                      <ul className="list-disc pl-5">
                        {aprovacao.abaixo.map(a => <li key={a.motoId}>{nomeDaMoto(a.motoId)}: líquido {brl(a.liquido)}, mínimo {brl(a.minimo)}.</li>)}
                      </ul>
                    )}
                  </div>
                  <Label htmlFor="efetivar-motivo">
                    {aprovacao.tipo === 'valor_minimo' ? 'Motivo do pedido de aprovação' : 'Motivo do pedido de aprovação (opcional)'}
                  </Label>
                  <Textarea id="efetivar-motivo" value={motivo} onChange={e => setMotivo(e.target.value)} />
                </div>
              )}
            </div>
          </div>
          <DialogFooter className="flex-col items-stretch max-lg:sticky max-lg:-bottom-4 max-lg:z-10 max-lg:bg-popover sm:flex-row sm:items-center sm:justify-between">
            <p aria-label="Total do pedido" className="text-sm text-muted-foreground">Total do pedido <strong className="block text-lg text-foreground">{brl(total)}</strong></p>
            <div className="grid grid-cols-2 gap-2 sm:flex">
              <Button variant="outline" className="h-11" disabled={loading} onClick={() => setOpen(false)}>Cancelar</Button>
              <Button className="h-11" onClick={efetivar} disabled={loading || !podeEfetivar}>
                {loading ? 'Enviando...' : aprovacao?.tipo ? 'Pedir aprovação' : 'Confirmar venda'}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
