'use client'
import { useState, type ReactNode } from 'react'
import { Bike, ChevronUp, Gift, Package, Plus, type LucideIcon } from 'lucide-react'
import { CampoBusca } from '@/components/ui/campo-busca'
import { filtrarPecas } from '@/lib/busca-peca'
import { brl } from '@/lib/dashboard-painel'
import { finalDoChassi } from '@/lib/painel-fabrica'
import type { PecaComSaldo } from '@/lib/pecas-da-conta'
import { motosParaAdicionar, totalDasMotos, totalDasPecasNaTela, type MotoDisponivel, type MotoNoPedido, type PecaNoPedido } from '@/lib/novo-pedido'

type Bloco = 'motos' | PecaNoPedido['tipo']
type Props = {
  disponiveis: readonly MotoDisponivel[]
  noPedido: readonly MotoNoPedido[]
  pecas: readonly PecaNoPedido[]
  catalogo: { lista: PecaComSaldo[] | null; erro: string | null }
  onPorMoto: (m: MotoDisponivel) => void
  onPorPeca: (tipo: PecaNoPedido['tipo'], peca: PecaComSaldo) => void
  /** Os mesmos itens do desktop (valor, quantidade, saldo, lixeira), desenhados pelo diálogo. */
  moto: (m: MotoNoPedido) => ReactNode
  peca: (p: PecaNoPedido, i: number) => ReactNode
}

const itens = (n: number) => (n === 1 ? '1 item' : `${n} itens`)

/**
 * Celular do Novo pedido (#24, N3): o próprio pedido em blocos (Motos, Acessórios, Brindes); o bloco abre com os itens dele e
 * a busca embutida, e um toque põe o item ali. Nada cobre o pedido enquanto se escolhe (regra do Luis).
 */
export function ItensNoCelular({ disponiveis, noPedido, pecas, catalogo, onPorMoto, onPorPeca, moto, peca }: Props) {
  const [aberto, setAberto] = useState<Bloco | null>('motos')
  const [busca, setBusca] = useState('')
  const abrir = (b: Bloco) => { setBusca(''); setAberto(atual => (atual === b ? null : b)) }
  const semMoto = noPedido.length === 0
  const motos = motosParaAdicionar(disponiveis, { lojaId: noPedido[0]?.lojaId, fora: noPedido.map(m => m.id) }, busca)

  return (
    <div className="space-y-3">
      <BlocoDoPedido titulo="Motos" Icone={Bike} resumo={itens(noPedido.length)} valor={brl(totalDasMotos(noPedido))} aberto={aberto === 'motos'} onAbrir={() => abrir('motos')}>
        {noPedido.length > 0 && <ul aria-label="Motos do pedido" className="divide-y divide-border">{noPedido.map(moto)}</ul>}
        <CampoBusca aria-label="Buscar moto" placeholder="Modelo, cor ou final do chassi" value={busca} onChange={e => setBusca(e.target.value)} />
        <Resultados vazio="Nenhuma moto disponível com essa busca." itens={motos.map(m => ({
          id: m.id, nome: `${m.marca} ${m.modelo} (final ${finalDoChassi(m.chassi)})`, detalhe: `${m.cor.toLowerCase()}, ${m.lojaNome}`, onPor: () => onPorMoto(m),
        }))} />
      </BlocoDoPedido>
      {(['acessorio', 'brinde'] as const).map(tipo => {
        const doTipo = pecas.map((p, i) => [p, i] as const).filter(([p]) => p.tipo === tipo)
        const achadas = busca.trim() && catalogo.lista ? filtrarPecas(catalogo.lista, busca, 6) : []
        return (
          <BlocoDoPedido key={tipo} titulo={tipo === 'brinde' ? 'Brindes' : 'Acessórios'} Icone={tipo === 'brinde' ? Gift : Package}
            resumo={itens(doTipo.reduce((n, [p]) => n + p.quantidade, 0))} desabilitado={semMoto}
            valor={tipo === 'brinde' ? 'Sem cobrança' : brl(totalDasPecasNaTela(doTipo.map(([p]) => p)))}
            aberto={aberto === tipo} onAbrir={() => abrir(tipo)}>
            {doTipo.length > 0 && <ul aria-label={tipo === 'brinde' ? 'Brindes do pedido' : 'Acessórios do pedido'} className="divide-y divide-border">{doTipo.map(([p, i]) => peca(p, i))}</ul>}
            <CampoBusca aria-label="Buscar peça" placeholder="Digite o nome da peça" value={busca} onChange={e => setBusca(e.target.value)} />
            {catalogo.erro
              ? <p role="alert" className="text-sm text-destructive">Não deu para carregar as peças: {catalogo.erro}</p>
              : busca.trim() && <Resultados vazio="Nenhuma peça com esse nome." itens={achadas.map(p => ({
                id: p.id, nome: p.nome, detalhe: `${brl(Number(p.valor))}, saldo ${p.quantidadeEstoque}`, onPor: () => onPorPeca(tipo, p),
              }))} />}
          </BlocoDoPedido>
        )
      })}
      {semMoto && <p className="text-xs text-muted-foreground">Escolha a moto primeiro: acessórios e brindes vêm do catálogo da loja dela.</p>}
    </div>
  )
}

function BlocoDoPedido({ titulo, Icone, resumo, valor, aberto, desabilitado, onAbrir, children }: {
  titulo: string; Icone: LucideIcon; resumo: string; valor: string; aberto: boolean; desabilitado?: boolean; onAbrir: () => void; children: ReactNode
}) {
  return (
    <section className={`rounded-lg border ${aberto ? 'border-primary' : 'border-border'}`}>
      <button type="button" aria-expanded={aberto} disabled={desabilitado} onClick={onAbrir}
        className="flex min-h-14 w-full items-center gap-3 p-3 text-left disabled:opacity-50">
        <Icone className="size-5 shrink-0 text-muted-foreground" aria-hidden />
        <span className="flex-1"><span className="block font-medium">{titulo}</span><span className="block text-xs text-muted-foreground">{resumo}</span></span>
        <span className="text-sm font-semibold">{valor}</span>
        {aberto ? <ChevronUp className="size-5" aria-hidden /> : <Plus className="size-5" aria-hidden />}
      </button>
      {aberto && <div className="space-y-3 border-t border-border p-3">{children}</div>}
    </section>
  )
}

function Resultados({ itens, vazio }: { itens: { id: string; nome: string; detalhe: string; onPor: () => void }[]; vazio: string }) {
  if (itens.length === 0) return <p className="text-sm text-muted-foreground">{vazio}</p>
  return (
    <ul className="divide-y divide-border rounded-lg border border-border">
      {itens.map(r => (
        <li key={r.id} className="flex items-center gap-2 p-3">
          <span className="min-w-0 flex-1"><span className="block font-medium">{r.nome}</span><span className="block text-xs text-muted-foreground">{r.detalhe}</span></span>
          <button type="button" aria-label={`Pôr ${r.nome} no pedido`} onClick={r.onPor} className="flex size-11 items-center justify-center rounded-lg text-primary-text">
            <Plus className="size-5" aria-hidden />
          </button>
        </li>
      ))}
    </ul>
  )
}
