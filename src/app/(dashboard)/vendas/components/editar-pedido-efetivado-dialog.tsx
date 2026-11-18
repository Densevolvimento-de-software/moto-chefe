'use client'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Lock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { editarPedidoEfetivadoAction, pedidoEfetivadoAction } from '../actions'
import { NaNota, ReciboDoPedido } from './recibo-do-pedido'
import { ResumoDaEntrega } from './resumo-da-entrega'
import { BarraDoPagamento } from './barra-do-pagamento'
import { PagamentosFields, pagamentosDoFormulario, pgtoHandlers, pgtoIncompleto, pgtosDoPagamento, type Pgto } from '@/app/(dashboard)/estoque/components/pagamentos-fields'
import { useMaquininhas } from '@/components/use-maquininhas'
import { OrigemVendaSelect } from '@/components/origem-venda-select'
import type { OrigemParaEscolher } from '@/lib/queries/origens-venda'
import { DocumentoClienteInput } from '@/components/documento-cliente'
import { lerDocumentoCliente } from '@/lib/documento'
import { aprovacaoDoPedido, foraDaMoto, totalDoPedido } from '@/lib/pedido-venda-regras'
import { motosDoEnvio, totalDasMotos } from '@/lib/novo-pedido'
import { pagamentosIncompletos, situacaoDoPagamento } from '@/lib/pagamentos-entrada'
import { podeAlterarValorVenda } from '@/lib/valor-venda'
import { avisoDaTrava } from '@/lib/pedido-efetivado-regras'
import { liquidoDaMoto } from '@/lib/preco-minimo'
import { brl } from '@/lib/dashboard-painel'

type Props = {
  vendaId: string
  papel: string
  vendedores: { id: string; nome: string }[]
  origens: OrigemParaEscolher[]
  gatilho: (abrir: () => void) => ReactNode
}
type Pedido = Extract<Awaited<ReturnType<typeof pedidoEfetivadoAction>>, { ok: true }>['dados']
type Formulario = { valores: Record<string, string>; valoresDaPeca: Record<string, string>; clienteNome: string; clienteCpf: string
  dataVenda: string; vendedorId: string; origemId: string; origemDetalhe: string; pgtos: Pgto[] }

const formularioDo = (p: Pedido): Formulario => ({
  valores: Object.fromEntries(p.motos.map(m => [m.id, m.valor])),
  valoresDaPeca: Object.fromEntries(p.pecas.map(x => [x.pecaId, x.valor])),
  clienteNome: p.comprador.clienteNome ?? '', clienteCpf: p.comprador.clienteCpf ?? '',
  dataVenda: p.dataVenda, vendedorId: p.vendedorId, origemId: p.origemId ?? '', origemDetalhe: p.origemDetalhe ?? '',
  pgtos: pgtosDoPagamento(p.pagamentos),
})

const quemEOCliente = (motos: number) => (motos === 1 ? 'O cliente do pedido.' : `O mesmo cliente para as ${motos} motos.`)

/** A quem a data, o vendedor e a origem valem: as vendas do pedido e a venda de peça, só com o que o pedido tem. */
function aQuemVale(motos: number, tipos: ReadonlySet<string>) {
  const pecas = (['brinde', 'acessorio'] as const).filter(t => tipos.has(t)).map(t => (t === 'brinde' ? 'o brinde' : 'o acessório')).join(' e ')
  return `Vale para ${motos === 1 ? 'a venda do pedido' : `as ${motos} vendas do pedido`}${pecas ? ` e para ${pecas}` : ''}.`
}

/**
 * Editar venda de um pedido com várias motos, brinde ou acessório (#25, 25d; protótipos V2 e 25d aprovados): edita o pedido inteiro pelo
 * servidor do #23. Com NF valendo, cliente e valores ficam como estão (`notaQueTrava`, a mesma regra do servidor); sem NF, quem altera valor
 * muda o de cada moto e acessório. Frete e Entrega só na prévia da NF.
 */
export function EditarPedidoEfetivadoDialog({ vendaId, papel, vendedores, origens, gatilho }: Props) {
  const [open, setOpen] = useState(false)
  const [carga, setCarga] = useState<{ pedido: Pedido | null; erro: string | null }>({ pedido: null, erro: null })
  const [f, setF] = useState<Formulario | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const leitura = useRef(0)
  const pedido = carga.pedido
  const maquininhas = useMaquininhas(pedido ? { loja: pedido.lojaId } : null)
  const muda = (patch: Partial<Formulario>) => setF(atual => (atual ? { ...atual, ...patch } : atual))
  const pgto = pgtoHandlers(pgtos => setF(atual => (atual ? { ...atual, pgtos: typeof pgtos === 'function' ? pgtos(atual.pgtos) : pgtos } : atual)))

  useEffect(() => {
    if (!open) return
    const esta = ++leitura.current
    setCarga({ pedido: null, erro: null })
    setF(null)
    setErro(null)
    pedidoEfetivadoAction(vendaId)
      .then(r => {
        if (esta !== leitura.current) return
        setCarga(r.ok ? { pedido: r.dados, erro: null } : { pedido: null, erro: r.erro })
        if (r.ok) setF(formularioDo(r.dados))
      })
      .catch(() => { if (esta === leitura.current) setCarga({ pedido: null, erro: 'tente de novo em instantes.' }) })
  }, [open, vendaId])

  const trava = pedido?.notaQueTrava ?? null
  // Pelo nº de NF do Bling (papel) a nota não é do MOVA: os valores ficam fixos, sem "Na nota".
  const naNota = trava?.por === 'nota'
  const motos = (pedido?.motos ?? []).map(m => ({ ...m, valor: f?.valores[m.id] ?? m.valor }))
  const pecas = (pedido?.pecas ?? []).map(p => ({ ...p, valor: f?.valoresDaPeca[p.pecaId] ?? p.valor }))
  const pecasDoTotal = pecas.map(p => ({ quantidade: p.quantidade, valorUnitario: p.valor }))
  const total = totalDoPedido(totalDasMotos(motos), pedido?.entrega ?? null, pecasDoTotal)
  const pagamentos = pagamentosDoFormulario(f?.pgtos ?? [])
  const situacao = situacaoDoPagamento(pagamentos, total)
  const envio = motosDoEnvio(motos)
  const motosComValor = envio?.every(m => m.valor !== undefined) ? envio.map(m => ({ motoId: m.motoId, valor: m.valor! })) : null
  const selos = pedido?.taxas && motosComValor && situacao.tipo === 'pago' ? aprovacaoDoPedido({
    sensivelSemPermissao: false, papel,
    liquido: liquidoDaMoto(pagamentos, pedido.taxas, foraDaMoto(pedido.entrega, pecasDoTotal)),
    motos: motosComValor.map(m => ({ ...m, minimo: motos.find(x => x.id === m.motoId)?.minimo ?? null })),
  }).porMoto : null
  const podeSalvar = !!f && !!motosComValor && !!f.clienteNome.trim() && lerDocumentoCliente(f.clienteCpf).ok && situacao.tipo === 'pago'
    && !pagamentosIncompletos(pagamentos) && !f.pgtos.some(p => pgtoIncompleto(p, pedido?.taxas ?? null, maquininhas))

  async function salvar() {
    if (!f || !podeSalvar || !motosComValor) return
    setLoading(true)
    setErro(null)
    try {
      const r = await editarPedidoEfetivadoAction(vendaId, {
        clienteNome: f.clienteNome, clienteCpf: f.clienteCpf, dataVenda: f.dataVenda, vendedorId: f.vendedorId || undefined,
        origemId: f.origemId || undefined, origemDetalhe: f.origemDetalhe.trim() || undefined, pagamentos, motos: motosComValor,
        acessorios: pecas.filter(p => p.tipo === 'acessorio').map(p => ({ pecaId: p.pecaId, valor: Number(p.valor) })),
      })
      if (r.ok) setOpen(false)
      else setErro(r.erro)
    } catch {
      setErro('Não deu para salvar agora. Tente de novo.')
    } finally {
      setLoading(false)
    }
  }

  const naPrevia = <span className="text-xs font-medium text-muted-foreground">Altere na prévia da NF</span>
  const lojaNome = motos[0]?.lojaNome
  const ajudaDoCliente = trava?.por === 'nota' ? 'Está na nota: não muda.' : trava ? 'Só os administradores mudam o cliente.'
    : 'Contato e endereço seguem como estão no cadastro da venda.'

  return (
    <>
      {gatilho(() => setOpen(true))}
      {/* Enquanto grava, nada fecha o diálogo: a recusa do servidor fica à vista. */}
      <Dialog open={open} onOpenChange={o => { if (!loading) setOpen(o) }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-5xl">
          <DialogHeader>
            <DialogTitle>Editar venda do pedido {pedido?.numero ?? ''}</DialogTitle>
            <DialogDescription>
              {trava ? 'Venda efetivada, com a nota fiscal valendo.' : 'Venda efetivada, sem nota fiscal valendo.'}{lojaNome && ` ${lojaNome}.`}
            </DialogDescription>
          </DialogHeader>
          {carga.erro ? <p role="alert" className="text-sm text-destructive">Não deu para carregar o pedido: {carga.erro}</p>
            : !pedido || !f ? <p className="text-sm text-muted-foreground">Carregando os itens do pedido...</p> : (
            // O recibo vem antes no DOM: no celular ele fica em cima; no desktop vai para a coluna da direita.
            <div className="grid gap-6 lg:grid-cols-2">
              <div className="space-y-3 lg:order-2">
                <ReciboDoPedido motos={motos} pecas={pecas} selos={selos} frete={pedido.frete} travado={naNota}
                  podeAlterarValor={podeAlterarValorVenda(papel)} acaoDoFrete={naNota ? <NaNota /> : naPrevia}
                  onValor={(id, v) => muda({ valores: { ...f.valores, [id]: v } })}
                  onValorDaPeca={(id, v) => muda({ valoresDaPeca: { ...f.valoresDaPeca, [id]: v } })} />
                <ResumoDaEntrega rotulo="Entrega do pedido" entrega={pedido.entrega} sufixo="(do pedido)"
                  semEntrega={<p className="text-muted-foreground">Pedido sem a Entrega informada.</p>} acao={naNota ? <NaNota /> : naPrevia} />
              </div>
              <div className="space-y-5 lg:order-1">
                {trava && (
                  <p role="status" className="flex gap-2 rounded-lg border border-border bg-muted p-3 text-sm">
                    <Lock className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />{avisoDaTrava(trava)}
                  </p>
                )}
                <section className="space-y-2">
                  <h3 className="font-medium">Cliente</h3>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1">
                      <Label htmlFor="editar-cliente-nome">{trava ? 'Nome' : 'Nome completo'}</Label>
                      <Input id="editar-cliente-nome" value={f.clienteNome} readOnly={!!trava} onChange={e => muda({ clienteNome: e.target.value })} />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="editar-cliente-cpf">CPF/CNPJ</Label>
                      {trava ? <Input id="editar-cliente-cpf" value={f.clienteCpf} readOnly />
                        : <DocumentoClienteInput id="editar-cliente-cpf" value={f.clienteCpf} onChange={v => muda({ clienteCpf: v })} />}
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground">{quemEOCliente(motos.length)} {ajudaDoCliente}</p>
                </section>
                <section className="space-y-3">
                  <h3 className="font-medium">Venda</h3>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1">
                      <Label htmlFor="editar-data">Data da venda</Label>
                      <Input id="editar-data" type="date" value={f.dataVenda} onChange={e => muda({ dataVenda: e.target.value })} />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="editar-vendedor">Vendedor</Label>
                      {/* Nativo: o value é id (o <Select> do base-ui mostraria o UUID). */}
                      <select id="editar-vendedor" value={f.vendedorId} onChange={e => muda({ vendedorId: e.target.value })}
                        className="flex h-9 w-full rounded-md border border-input bg-card px-3 py-1 text-sm">
                        {vendedores.map(v => <option key={v.id} value={v.id}>{v.nome}</option>)}
                      </select>
                    </div>
                  </div>
                  <OrigemVendaSelect origens={origens} origemId={f.origemId} onOrigemChange={id => muda({ origemId: id })}
                    detalhe={f.origemDetalhe} onDetalheChange={d => muda({ origemDetalhe: d })} />
                  <p className="text-xs text-muted-foreground">{aQuemVale(motos.length, new Set(pecas.map(p => p.tipo)))}</p>
                </section>
                <section aria-label="Pagamento do pedido" className="space-y-2">
                  <h3 className="font-medium">Pagamento do pedido</h3>
                  <PagamentosFields pgtos={f.pgtos} onAdd={pgto.add} onRemove={pgto.remove} onUpdate={pgto.update} taxasVenda={pedido.taxas} maquininhas={maquininhas} />
                  <BarraDoPagamento situacao={situacao} total={total} />
                </section>
              </div>
            </div>
          )}
          {erro && <p role="alert" className="text-sm text-destructive">{erro}</p>}
          <DialogFooter className="sticky -bottom-4 z-10 flex-col items-stretch bg-popover sm:flex-row sm:items-center sm:justify-between">
            <p aria-label="Total do pedido" className="text-sm text-muted-foreground">Total do pedido <strong className="block text-lg text-foreground">{brl(total)}</strong></p>
            <div className="grid grid-cols-2 gap-2 sm:flex">
              <Button variant="outline" className="h-11" disabled={loading} onClick={() => setOpen(false)}>Cancelar</Button>
              <Button className="h-11" onClick={salvar} disabled={loading || !podeSalvar}>{loading ? 'Salvando...' : 'Salvar alterações'}</Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
