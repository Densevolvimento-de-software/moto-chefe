// Tabelas do Painel da Fábrica. Sem estado nem 'use client': a tela e o impresso
// (src/app/(print)/fabrica/imprimir) mostram exatamente o mesmo. No celular (abaixo de `md`)
// as tabelas largas viram listas de toque com <details>, sem rolagem lateral (protótipo do #30);
// o impresso fica sempre com as tabelas.
import Link from 'next/link'
import { ChevronDown } from 'lucide-react'
import {
  celulasDaVenda, finalDoChassi, nomeDaLoja, resumirEstoque, resumirVendas, urlDoFiltro, COLUNAS_VENDAS, ROTA_PAINEL_FABRICA,
  type Celula, type FiltroPainel, type LinhaEstoquePainel, type LojaPainel, type VendaPainel,
} from '@/lib/painel-fabrica'
import { diaBrt, diaCurtoBrt } from '@/lib/data-venda'
import { fmtBRL } from '@/lib/preco-minimo'
import { plural } from '@/lib/texto'

const n = (v: number) => v.toLocaleString('pt-BR')

const th = 'px-3 py-2 text-xs font-medium text-muted-foreground'
const td = 'px-3 py-1.5'
const caixa = 'bg-card border rounded-lg overflow-x-auto'
const vazio = `${td} py-6 text-center text-muted-foreground`
const SEM_VENDA = 'Nenhuma venda no período com estes filtros.'
const NOTA_DO_VALOR = 'Valor da moto, sem frete nem acessório'
const motos = (q: number) => plural(q, 'moto', 'motos')
// Estilo de cada coluna da lista, na ordem de COLUNAS_VENDAS.
const CLASSE_DA_COLUNA = [
  'whitespace-nowrap tabular-nums', 'tabular-nums', 'whitespace-nowrap', 'whitespace-nowrap font-medium', '', 'font-mono text-xs whitespace-nowrap',
  'whitespace-nowrap tabular-nums text-right',
]
const COLUNA_VALOR = COLUNAS_VENDAS.indexOf('Valor da moto')
const textoDaCelula = (c: Celula) => (typeof c === 'object' ? fmtBRL(c.reais) : c)
// Só na tela larga e no papel; no celular, a lista de toque.
const SO_LARGA = 'hidden md:block print:block'
const SO_CELULAR = 'md:hidden print:hidden'
const linhaDeToque = 'list-none cursor-pointer select-none px-4 py-3 flex items-center gap-3'
const seta = <ChevronDown size={16} className="shrink-0 text-muted-foreground group-open:rotate-180" aria-hidden />

function Cabecalho({ titulo, detalhe }: { titulo: string; detalhe: string }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-3">
      <h2 className="text-lg font-semibold">{titulo}</h2>
      <p className="text-sm text-muted-foreground">{detalhe}</p>
    </div>
  )
}

export function TabelaEstoque({ lojas, estoque }: { lojas: LojaPainel[]; estoque: LinhaEstoquePainel[] }) {
  const e = resumirEstoque(estoque)
  const emEstoque = new Map(e.porLoja.map(p => [p.chave, p.quantidade]))
  const lojasComEstoque = lojas
    .flatMap(l => {
      const quantidade = emEstoque.get(l.lojaId)
      return quantidade === undefined ? [] : [{ lojaId: l.lojaId, nome: l.lojaNome, quantidade }]
    })
    .sort((a, b) => b.quantidade - a.quantidade || a.nome.localeCompare(b.nome, 'pt-BR'))

  return (
    <section className="space-y-3">
      <Cabecalho titulo="Estoque geral por modelo e cor" detalhe={`${n(e.total)} motos em estoque hoje`} />
      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <div className={caixa}>
          <table className="w-full text-sm">
            <thead className="bg-muted border-b">
              <tr><th className={`${th} text-left`}>Modelo</th><th className={`${th} text-left`}>Cor</th><th className={`${th} text-right`}>Qtd</th></tr>
            </thead>
            <tbody className="divide-y">
              {e.modeloCor.length === 0 && (
                <tr><td colSpan={3} className={vazio}>Nenhuma moto MotoChefe em estoque com estes filtros.</td></tr>
              )}
              {e.porModelo.map(m => [
                ...e.modeloCor.filter(l => l.modelo === m.chave).map((l, i) => (
                  <tr key={`${l.modelo}-${l.cor}`}>
                    <td className={`${td} font-medium`}>{i === 0 ? l.modelo : ''}</td>
                    <td className={td}>{l.cor}</td>
                    <td className={`${td} text-right tabular-nums`}>{n(l.quantidade)}</td>
                  </tr>
                )),
                <tr key={`${m.chave}-total`} className="bg-muted/50">
                  <td className={`${td} text-xs text-muted-foreground`} colSpan={2}>Total {m.chave}</td>
                  <td className={`${td} text-right font-semibold tabular-nums`}>{n(m.quantidade)}</td>
                </tr>,
              ])}
            </tbody>
            {e.total > 0 && (
              <tfoot className="border-t-2">
                <tr><td className={`${td} font-semibold`} colSpan={2}>Total geral</td><td className={`${td} text-right font-bold tabular-nums`}>{n(e.total)}</td></tr>
              </tfoot>
            )}
          </table>
        </div>

        <div className={`${caixa} self-start`}>
          <table className="w-full text-sm">
            <thead className="bg-muted border-b">
              <tr><th className={`${th} text-left`}>Estoque por loja</th><th className={`${th} text-right`}>Qtd</th></tr>
            </thead>
            <tbody className="divide-y">
              {lojasComEstoque.length === 0 && (
                <tr><td colSpan={2} className={vazio}>Nenhuma loja com estoque com estes filtros.</td></tr>
              )}
              {lojasComEstoque.map(l => (
                <tr key={l.lojaId}>
                  <td className={`${td} font-medium`}>{l.nome}</td>
                  <td className={`${td} text-right tabular-nums`}>{n(l.quantidade)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  )
}

type ResumoVendas = ReturnType<typeof resumirVendas>
type LojaComVenda = LojaPainel & { motos: number; valor: number }

export function TabelaVendas({ lojas, vendas, periodo, filtro, de, ate, impresso = false }: {
  lojas: LojaPainel[]
  /** Já filtradas e em ordem (filtrarVendas): uma linha por moto vendida. */
  vendas: VendaPainel[]
  /** "01/11/2026 a 09/11/2026" */
  periodo: string
  filtro: FiltroPainel
  de: string
  ate: string
  /** No papel, sem links e com o faturamento por loja aberto. */
  impresso?: boolean
}) {
  const v = resumirVendas(vendas)
  const nomeLoja = nomeDaLoja(lojas)
  const lojasComVenda: LojaComVenda[] = lojas
    .map(l => ({ ...l, motos: v.porLoja.get(l.lojaId) ?? 0, valor: v.valorPorLoja.get(l.lojaId) ?? 0 }))
    .filter(l => l.motos > 0)
    .sort((a, b) => b.motos - a.motos || a.lojaNome.localeCompare(b.lojaNome, 'pt-BR'))
  // Clicar na loja filtra só ela, mantendo modelo, cor e período.
  const soDaLoja = (lojaId: string) => `${ROTA_PAINEL_FABRICA}?${urlDoFiltro({ ...filtro, lojas: [lojaId] }, de, ate, 'vendas')}`

  return (
    <div className="space-y-8">
      <FaixaFaturamento v={v} lojas={lojasComVenda} impresso={impresso} />

      <section className="space-y-3">
        <Cabecalho titulo="Vendas por loja" detalhe={`${periodo} · ${n(v.total)} motos`} />
        <div role="group" aria-label="Tabelas de vendas por loja" className="hidden md:grid print:grid gap-4 lg:grid-cols-[1fr_2fr] print:grid-cols-[1fr_2fr]">
          <div className={`${caixa} self-start`}>
            <table className="w-full text-sm">
              <thead className="bg-muted border-b">
                <tr><th className={`${th} text-left`}>Loja</th><th className={`${th} text-right`}>Motos vendidas</th></tr>
              </thead>
              <tbody className="divide-y">
                {lojasComVenda.length === 0 && <tr><td colSpan={2} className={vazio}>{SEM_VENDA}</td></tr>}
                {lojasComVenda.map(l => (
                  <tr key={l.lojaId}>
                    <td className={td}>
                      {impresso
                        ? <span className="font-medium">{l.lojaNome}</span>
                        : <Link href={soDaLoja(l.lojaId)} className="font-medium text-primary-text hover:underline">{l.lojaNome}</Link>}
                    </td>
                    <td className={`${td} text-right tabular-nums font-semibold`}>{n(l.motos)}</td>
                  </tr>
                ))}
              </tbody>
              {v.total > 0 && (
                <tfoot className="border-t-2">
                  <tr><td className={`${td} font-semibold`}>Total</td><td className={`${td} text-right font-bold tabular-nums`}>{n(v.total)}</td></tr>
                </tfoot>
              )}
            </table>
          </div>

          <div className={`${caixa} self-start`}>
            <table className="w-full text-sm">
              <thead className="bg-muted border-b">
                <tr>
                  <th className={`${th} text-left sticky left-0 bg-muted`}>Loja × modelo</th>
                  {v.modelos.map(m => <th key={m} className={`${th} text-right whitespace-nowrap`}>{m}</th>)}
                  <th className={`${th} text-right`}>Total</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {lojasComVenda.length === 0 && <tr><td colSpan={v.modelos.length + 2} className={vazio}>{SEM_VENDA}</td></tr>}
                {lojasComVenda.map(l => (
                  <tr key={l.lojaId}>
                    <td className={`${td} font-medium whitespace-nowrap sticky left-0 bg-card`}>{l.lojaNome}</td>
                    {v.modelos.map(m => {
                      const q = v.celula(l.lojaId, m)
                      return <td key={m} className={`${td} text-right tabular-nums ${q === 0 ? 'text-muted-foreground' : ''}`}>{n(q)}</td>
                    })}
                    <td className={`${td} text-right font-semibold tabular-nums`}>{n(l.motos)}</td>
                  </tr>
                ))}
              </tbody>
              {v.total > 0 && (
                <tfoot className="border-t-2">
                  <tr>
                    <td className={`${td} font-semibold sticky left-0 bg-card`}>Total</td>
                    {v.modelos.map(m => <td key={m} className={`${td} text-right font-semibold tabular-nums`}>{n(v.porModelo.get(m) ?? 0)}</td>)}
                    <td className={`${td} text-right font-bold tabular-nums`}>{n(v.total)}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>
        <LojaModeloCelular v={v} lojas={lojasComVenda} />
      </section>

      <section className="space-y-3 break-before-page">
        <Cabecalho titulo="Detalhes das vendas" detalhe={`${n(vendas.length)} vendas, da mais recente para a mais antiga`} />
        <div className={`${caixa} ${SO_LARGA}`}>
          <table aria-label="Detalhes das vendas" className="w-full text-sm">
            <thead className="bg-muted border-b">
              <tr>
                {COLUNAS_VENDAS.map((c, i) => <th key={c} className={`${th} ${i === COLUNA_VALOR ? 'text-right' : 'text-left'}`}>{c}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y">
              {vendas.length === 0 && <tr><td colSpan={COLUNAS_VENDAS.length} className={vazio}>{SEM_VENDA}</td></tr>}
              {vendas.map(x => (
                <tr key={`${x.numero}-${x.chassi}`}>
                  {celulasDaVenda(x, nomeLoja).map((c, i) => <td key={COLUNAS_VENDAS[i]} className={`${td} ${CLASSE_DA_COLUNA[i]}`}>{textoDaCelula(c)}</td>)}
                </tr>
              ))}
            </tbody>
            {v.total > 0 && (
              <tfoot className="border-t-2">
                <tr>
                  <td className={`${td} font-semibold`} colSpan={COLUNA_VALOR}>Total, {motos(v.total)}</td>
                  <td className={`${td} text-right font-bold tabular-nums whitespace-nowrap`}>{fmtBRL(v.valor)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
        <VendasCelular vendas={vendas} nomeLoja={nomeLoja} v={v} />
      </section>
    </div>
  )
}

/** Faturamento do período no topo. Tela larga: "Ver por loja" recolhível; celular: só o total; papel: aberto. */
function FaixaFaturamento({ v, lojas, impresso }: { v: ResumoVendas; lojas: LojaComVenda[]; impresso: boolean }) {
  const maior = Math.max(0, ...lojas.map(l => l.valor))
  const porLoja = (
    <ul className="border-t px-4 py-3 space-y-2">
      {[...lojas].sort((a, b) => b.valor - a.valor).map(l => (
        <li key={l.lojaId} className="grid grid-cols-[minmax(8rem,12rem)_1fr_auto_5rem] items-center gap-4 text-sm">
          <span className="font-medium truncate">{l.lojaNome}</span>
          <span className="h-2 rounded-full bg-muted overflow-hidden" style={{ printColorAdjust: 'exact', WebkitPrintColorAdjust: 'exact' }} aria-hidden>
            {/* Sem print-color-adjust o navegador some com a barra no papel (como em coletiva-view). */}
            <span
              className="block h-full rounded-full bg-primary"
              style={{ width: `${maior > 0 ? (l.valor / maior) * 100 : 0}%`, printColorAdjust: 'exact', WebkitPrintColorAdjust: 'exact' }}
            />
          </span>
          <span className="font-semibold tabular-nums text-right">{fmtBRL(l.valor)}</span>
          <span className="text-muted-foreground text-right">{motos(l.motos)}</span>
        </li>
      ))}
    </ul>
  )

  return (
    <section aria-label="Faturamento no período" className="relative bg-card border rounded-lg">
      <div className={`flex flex-col gap-1 px-4 py-3 md:flex-row md:items-center md:gap-6 ${impresso ? '' : 'md:pr-44'}`}>
        <div>
          <p className="text-xs text-muted-foreground">Faturamento no período</p>
          <p className="text-2xl font-bold tabular-nums">{fmtBRL(v.valor)}</p>
        </div>
        <p className="text-sm"><span className="font-semibold">{motos(v.total)}</span> em {plural(lojas.length, 'loja', 'lojas')}</p>
        <p className="text-sm text-muted-foreground">{NOTA_DO_VALOR}</p>
      </div>
      {lojas.length > 0 && (impresso
        ? <div role="group" aria-label="Faturamento por loja">{porLoja}</div>
        : (
          <details aria-label="Faturamento por loja" className="group hidden md:block">
            <summary className="list-none cursor-pointer select-none absolute right-4 top-4 h-11 px-2 inline-flex items-center gap-1 rounded-md text-sm font-medium text-primary-text hover:bg-muted">
              <span className="group-open:hidden">Ver por loja</span>
              <span className="hidden group-open:inline">Esconder por loja</span>
              <ChevronDown size={14} className="group-open:rotate-180" aria-hidden />
            </summary>
            {porLoja}
          </details>
        ))}
    </section>
  )
}

/** Celular: uma linha por loja com as motos; o toque abre o faturamento da loja e cada modelo. */
function LojaModeloCelular({ v, lojas }: { v: ResumoVendas; lojas: LojaComVenda[] }) {
  return (
    <ul aria-label="Vendas por loja e modelo" className={`${SO_CELULAR} bg-card border rounded-lg divide-y`}>
      {lojas.length === 0 && <li className={vazio}>{SEM_VENDA}</li>}
      {lojas.map(l => (
        <li key={l.lojaId}>
          <details className="group">
            <summary className={linhaDeToque}>
              <span className="flex-1 min-w-0 font-semibold">{l.lojaNome}</span>
              <span className="text-sm text-muted-foreground whitespace-nowrap">{motos(l.motos)}</span>
              {seta}
            </summary>
            <dl className="bg-muted/50 px-4 py-3 space-y-1 text-sm">
              <div className="flex justify-between gap-3 font-semibold"><dt>Faturamento</dt><dd className="tabular-nums">{fmtBRL(l.valor)}</dd></div>
              {v.modelos.map(m => {
                const q = v.celula(l.lojaId, m)
                return (
                  <div key={m} className="flex justify-between gap-3">
                    <dt>{m}</dt><dd className={`tabular-nums ${q === 0 ? 'text-muted-foreground' : ''}`}>{n(q)}</dd>
                  </div>
                )
              })}
            </dl>
          </details>
        </li>
      ))}
      {v.total > 0 && (
        <li className="flex justify-between gap-3 px-4 py-3 font-semibold"><span>Total</span><span>{motos(v.total)}</span></li>
      )}
    </ul>
  )
}

/** Celular: duas linhas por venda (modelo e valor; dia, loja, cor e final do chassi); o toque abre o resto. */
function VendasCelular({ vendas, nomeLoja, v }: { vendas: VendaPainel[]; nomeLoja: (lojaId: string) => string; v: ResumoVendas }) {
  return (
    <ul aria-label="Vendas, uma por linha" className={`${SO_CELULAR} bg-card border rounded-lg divide-y`}>
      {vendas.length === 0 && <li className={vazio}>{SEM_VENDA}</li>}
      {vendas.map(x => (
        <li key={`${x.numero}-${x.chassi}`}>
          <details className="group">
            <summary className={linhaDeToque}>
              <span className="flex-1 min-w-0">
                <span className="flex justify-between gap-3 font-semibold">
                  <span>{x.modelo}</span><span className="tabular-nums whitespace-nowrap">{fmtBRL(x.valor)}</span>
                </span>
                <span className="block text-xs text-muted-foreground">
                  {[diaCurtoBrt(x.data), nomeLoja(x.lojaId), x.cor, `final ${finalDoChassi(x.chassi)}`].join(' · ')}
                </span>
              </span>
              {seta}
            </summary>
            <dl className="bg-muted/50 px-4 py-3 space-y-1 text-sm">
              {[['Data', diaBrt(x.data)], ['Venda', String(x.numero)], ['Loja', nomeLoja(x.lojaId)]].map(([rotulo, valor]) => (
                <div key={rotulo} className="flex gap-4"><dt className="w-14 shrink-0 text-muted-foreground">{rotulo}</dt><dd>{valor}</dd></div>
              ))}
              <div className="flex gap-4"><dt className="w-14 shrink-0 text-muted-foreground">Chassi</dt><dd className="font-mono text-xs break-all">{x.chassi}</dd></div>
            </dl>
          </details>
        </li>
      ))}
      {v.total > 0 && (
        <li className="px-4 py-3">
          <div className="flex justify-between gap-3 font-semibold">
            <span>Total, {motos(v.total)}</span><span className="text-lg font-bold tabular-nums whitespace-nowrap">{fmtBRL(v.valor)}</span>
          </div>
          <p className="text-xs text-muted-foreground">{NOTA_DO_VALOR}</p>
        </li>
      )}
    </ul>
  )
}
