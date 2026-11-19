'use client'
import { useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { SheetTitle } from '@/components/ui/sheet'
import { GavetaDeBaixo } from '@/components/gaveta-de-baixo'
import { LinhaDeDetalhe } from '@/components/linha-de-detalhe'
import { cn } from '@/lib/utils'
import { brl } from '@/lib/dashboard-painel'
import { dataPuraBr } from '@/lib/data-venda'
import type { LinhaNaTela } from '@/lib/conciliacao-linha-tela'
import { BotaoDesvincular, ChipDoAlvo, VincularVendaButton } from './vincular-venda-button'

const NAO_SE_VINCULA = 'Não se vincula: o dinheiro voltou ao cliente.'

/**
 * Transações da /conciliacao (#51, V2): tabela no desktop; no celular, lista de duas linhas e a folha de baixo com os
 * detalhes. Estornada sai apagada, com o valor riscado e o selo, e sem Vincular nem Desvincular (o servidor também
 * recusa, `cartaoNaoEstornado`).
 */
export function TransacoesConciliacao({ linhas }: { linhas: LinhaNaTela[] }) {
  return (
    <>
      <Tabela linhas={linhas} />
      <ListaDoCelular linhas={linhas} />
    </>
  )
}

const Valor = ({ valor, riscado }: { valor: number; riscado: boolean }) => (riscado ? <s>{brl(valor)}</s> : <>{brl(valor)}</>)

const SeloDoTipo = ({ l }: { l: LinhaNaTela }) => (
  <Badge variant={l.credito ? 'default' : 'secondary'} className="text-xs">{l.rotulo}</Badge>
)
const SeloEstornado = () => <Badge variant="destructive" className="text-xs">Estornado</Badge>

const linkDaLinha = (l: LinhaNaTela, grande = false) => (
  <VincularVendaButton
    conciliacaoId={l.id}
    dataRef={l.data}
    valorRef={l.valor}
    vendaVinculada={l.alvo}
    tipoVinculado={l.alvo?.tipo}
    grande={grande}
  />
)

function Tabela({ linhas }: { linhas: LinhaNaTela[] }) {
  const th = 'px-4 py-3 font-medium text-muted-foreground'
  return (
    <div className="hidden overflow-hidden rounded-lg border border-border bg-card md:block">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-muted">
            <th className={cn(th, 'text-left')}>Data</th>
            <th className={cn(th, 'text-left')}>Operadora</th>
            <th className={cn(th, 'text-left')}>Tipo</th>
            <th className={cn(th, 'text-left')}>Portador</th>
            <th className={cn(th, 'text-right')}>Bruto</th>
            <th className={cn(th, 'text-right')}>Líquido</th>
            <th className={cn(th, 'text-left')}>NSU</th>
            <th className={cn(th, 'text-left')}>Venda</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {linhas.map(l => (
            <tr key={l.id} className={cn('transition-colors hover:bg-muted', l.estornada && 'bg-muted/60 text-muted-foreground')}>
              <td className="whitespace-nowrap px-4 py-3">{dataPuraBr(l.data)}</td>
              <td className="px-4 py-3 text-muted-foreground">{l.operadora}</td>
              <td className="px-4 py-3">
                <div className="flex items-center gap-1.5">
                  <SeloDoTipo l={l} />
                  {l.estornada ? <SeloEstornado /> : l.bandeira && <span className="text-xs capitalize text-muted-foreground">{l.bandeira}</span>}
                </div>
              </td>
              <td className="max-w-[140px] truncate px-4 py-3 text-muted-foreground" title={l.portador}>{l.portador || '-'}</td>
              <td className={cn('whitespace-nowrap px-4 py-3 text-right font-medium', !l.estornada && 'text-foreground')}>
                <Valor valor={l.valor} riscado={l.estornada} />
              </td>
              <td className="whitespace-nowrap px-4 py-3 text-right text-muted-foreground">
                {l.liquido === null ? '-' : <Valor valor={l.liquido} riscado={l.estornada} />}
              </td>
              <td className="max-w-[120px] truncate px-4 py-3 font-mono text-xs text-muted-foreground" title={l.nsu ?? ''}>
                {l.nsu ? l.nsu.slice(-8) : '-'}
              </td>
              <td className="px-4 py-3">{l.estornada ? <span className="text-xs">Não se vincula</span> : linkDaLinha(l)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function ListaDoCelular({ linhas }: { linhas: LinhaNaTela[] }) {
  // Guarda só o id: depois da action, a lista recarregada traz a linha nova; se ela saiu do filtro, a folha fecha.
  const [abertaId, setAbertaId] = useState<string | null>(null)
  const aberta = linhas.find(l => l.id === abertaId)

  return (
    <>
      <ul aria-label="Transações" className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card md:hidden">
        {linhas.map(l => (
          <li
            key={l.id}
            className={cn('grid min-h-16 grid-cols-[minmax(0,1fr)_auto] items-center gap-2.5 py-2.5 pl-3.5 pr-2', l.estornada && 'bg-muted/60')}
          >
            <button type="button" onClick={() => setAbertaId(l.id)} className="min-w-0 text-left">
              <span className={cn('flex min-w-0 items-center gap-2', l.estornada ? 'text-muted-foreground' : 'font-semibold')}>
                <Valor valor={l.valor} riscado={l.estornada} />
                {l.estornada ? <SeloEstornado /> : <SeloDoTipo l={l} />}
              </span>
              <span className="flex flex-wrap gap-x-2.5 text-[13px] tabular-nums text-muted-foreground">
                <span>{dataPuraBr(l.data).slice(0, 5)}</span>
                <span>{l.operadora}</span>
                {l.estornada && <span>Não se vincula</span>}
              </span>
            </button>
            {!l.estornada && !l.alvo ? linkDaLinha(l, true) : (
              <span className="flex items-center gap-0.5 text-[13px]">
                {l.alvo && !l.estornada && (
                  <span className="flex items-center gap-1 whitespace-nowrap font-medium text-success">
                    <ChipDoAlvo tipo={l.alvo.tipo} />#{l.alvo.numero}
                  </span>
                )}
                <button
                  type="button"
                  aria-label="Abrir detalhes"
                  onClick={() => setAbertaId(l.id)}
                  className="flex size-11 items-center justify-center text-muted-foreground"
                >
                  <ChevronRight className="size-5" aria-hidden />
                </button>
              </span>
            )}
          </li>
        ))}
      </ul>

      <GavetaDeBaixo aberta={!!aberta} onAbertaChange={o => !o && setAbertaId(null)}>
        {aberta && <FolhaDaLinha l={aberta} />}
      </GavetaDeBaixo>
    </>
  )
}

function FolhaDaLinha({ l }: { l: LinhaNaTela }) {
  return (
    <div className="space-y-4">
      {/* pr-10: o X de fechar da gaveta fica no canto de cima, à direita. */}
      <div className="flex items-center justify-between gap-3 pr-10">
        <SheetTitle className="text-lg"><Valor valor={l.valor} riscado={l.estornada} /></SheetTitle>
        <span className="flex items-center gap-1.5">
          <SeloDoTipo l={l} />
          {l.estornada && <SeloEstornado />}
        </span>
      </div>
      <div className="text-sm tabular-nums">
        <LinhaDeDetalhe rotulo="Data">{dataPuraBr(l.data)}</LinhaDeDetalhe>
        <LinhaDeDetalhe rotulo="Operadora">
          {l.operadora}{l.bandeira && <>, <span className="capitalize">{l.bandeira}</span></>}
        </LinhaDeDetalhe>
        {l.liquido !== null && <LinhaDeDetalhe rotulo="Líquido"><Valor valor={l.liquido} riscado={l.estornada} /></LinhaDeDetalhe>}
        {l.nsu && <LinhaDeDetalhe rotulo="NSU">{l.nsu}</LinhaDeDetalhe>}
        {l.portador && <LinhaDeDetalhe rotulo="Portador">{l.portador}</LinhaDeDetalhe>}
        {l.alvo && (
          <LinhaDeDetalhe rotulo="Venda">
            <span className={cn('inline-flex items-center gap-1', !l.estornada && 'text-success')}>
              <ChipDoAlvo tipo={l.alvo.tipo} />#{l.alvo.numero}, {l.alvo.clienteNome}
            </span>
          </LinhaDeDetalhe>
        )}
      </div>
      {l.estornada ? <p className="text-sm text-muted-foreground">{NAO_SE_VINCULA}</p>
        : l.alvo ? <BotaoDesvincular conciliacaoId={l.id} cheio />
        : linkDaLinha(l, true)}
    </div>
  )
}
