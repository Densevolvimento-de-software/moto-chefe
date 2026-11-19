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
import { BotaoDesvincular, ChipDoAlvo, RotuloDoAlvo, VincularVendaButton } from './vincular-venda-button'

const NAO_SE_VINCULA = 'Não se vincula'
const NAO_SE_VINCULA_PORQUE = `${NAO_SE_VINCULA}: o dinheiro voltou ao cliente.`

/**
 * Transações da /conciliacao (#51, V2): tabela no desktop; no celular, lista de duas linhas e a folha de baixo com os
 * detalhes. Estornada sai apagada, com o valor riscado e o selo, e sem Vincular nem Desvincular (o servidor também
 * recusa, `cartaoNaoEstornado`). `podeVincular`: o mesmo `podeGerirConciliacao` com que o servidor recusa; sem ele, as
 * linhas e as vendas ligadas aparecem sem os botões.
 */
export function TransacoesConciliacao({ linhas, podeVincular }: { linhas: LinhaNaTela[]; podeVincular: boolean }) {
  return (
    <>
      <Tabela linhas={linhas} podeVincular={podeVincular} />
      <ListaDoCelular linhas={linhas} podeVincular={podeVincular} />
    </>
  )
}

const Valor = ({ valor, riscado }: { valor: number; riscado: boolean }) => (riscado ? <s>{brl(valor)}</s> : <>{brl(valor)}</>)

const SeloDoTipo = ({ l }: { l: LinhaNaTela }) => (
  <Badge variant={l.credito ? 'default' : 'secondary'} className="text-xs">{l.rotulo}</Badge>
)
const SeloEstornado = () => <Badge variant="destructive" className="text-xs">Estornado</Badge>

const botaoVincular = (l: LinhaNaTela, tamanho?: 'toque' | 'largo') => (
  <VincularVendaButton
    conciliacaoId={l.id}
    dataRef={l.data}
    valorRef={l.valor}
    vendaVinculada={l.alvo}
    tipoVinculado={l.alvo?.tipo}
    tamanho={tamanho}
  />
)

type Props = { linhas: LinhaNaTela[]; podeVincular: boolean }

// Coluna Venda da tabela: estornada não se vincula; sem permissão, só o que está ligado.
function VendaNaTabela({ l, podeVincular }: { l: LinhaNaTela; podeVincular: boolean }) {
  if (l.estornada) return <span className="text-xs">{NAO_SE_VINCULA}</span>
  if (podeVincular) return botaoVincular(l)
  return l.alvo ? <RotuloDoAlvo numero={l.alvo.numero} clienteNome={l.alvo.clienteNome} tipo={l.alvo.tipo} /> : null
}

function Tabela({ linhas, podeVincular }: Props) {
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
              <td className="px-4 py-3"><VendaNaTabela l={l} podeVincular={podeVincular} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function ListaDoCelular({ linhas, podeVincular }: Props) {
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
                {l.estornada && <span>{NAO_SE_VINCULA}</span>}
              </span>
            </button>
            {podeVincular && !l.estornada && !l.alvo ? botaoVincular(l, 'toque') : (
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
        {aberta && <FolhaDaLinha l={aberta} podeVincular={podeVincular} />}
      </GavetaDeBaixo>
    </>
  )
}

// Ação da folha: estornada explica por que não se vincula; sem permissão, nenhuma.
function AcaoDaFolha({ l, podeVincular }: { l: LinhaNaTela; podeVincular: boolean }) {
  if (l.estornada) return <p className="text-sm text-muted-foreground">{NAO_SE_VINCULA_PORQUE}</p>
  if (!podeVincular) return null
  return l.alvo ? <BotaoDesvincular conciliacaoId={l.id} cheio /> : botaoVincular(l, 'largo')
}

function FolhaDaLinha({ l, podeVincular }: { l: LinhaNaTela; podeVincular: boolean }) {
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
      <AcaoDaFolha l={l} podeVincular={podeVincular} />
    </div>
  )
}
