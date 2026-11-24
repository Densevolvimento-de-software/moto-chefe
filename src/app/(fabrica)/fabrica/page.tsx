import Link from 'next/link'
import { exigirPainelFabrica } from '../exigir-painel'
import { carregarPainelFabrica } from '@/lib/queries/painel-fabrica'
import {
  abaDaUrl, filtroDaUrl, filtrarEstoque, filtrarVendas, opcoesDoPainel, paraCsv, planilhaDoPainel, rotuloDaAba, urlDoFiltro,
  ABAS_PAINEL, AVISO_TETO_PERIODO, MARCA_PAINEL_FABRICA, ROTA_PAINEL_FABRICA, blocosDaAba, lojaDaSelecao, resumirModelos, resumirRede, resumirVendas,
  type ParamsPainel,
} from '@/lib/painel-fabrica'
import { hojeBrt } from '@/lib/data-venda'
import { periodoBr } from '@/lib/notas-emitidas'
import { cn } from '@/lib/utils'
import { FiltrosPainel } from './components/filtros-painel'
import { TabelaEstoque, TabelaVendas } from './components/tabelas-painel'
import { AcoesPainel } from './components/acoes-painel'
import { RedePainel } from './components/rede-painel'
import { ModelosPainel } from './components/modelos-painel'
import { LojaSelecionadaPainel } from './components/loja-selecionada-painel'

export default async function PainelFabricaPage({ searchParams }: { searchParams: Promise<ParamsPainel> }) {
  // Antes de qualquer busca (#579): lê todas as Contas; só o login da fábrica e o admin_geral.
  await exigirPainelFabrica()

  const params = await searchParams
  const aba = abaDaUrl(params.aba)
  const { de, ate, limitado, lojas, estoque, vendas } = await carregarPainelFabrica(params.de, params.ate)
  const filtro = filtroDaUrl(params)
  const { modelos, cores } = opcoesDoPainel(estoque, vendas)
  const estoqueFiltrado = filtrarEstoque(estoque, filtro)
  const vendasFiltradas = filtrarVendas(vendas, filtro)
  const planilha = planilhaDoPainel(aba, { lojas, estoque: estoqueFiltrado, vendas: vendasFiltradas, de, ate, hoje: hojeBrt() })
  const vendasResumo = resumirVendas(vendasFiltradas)
  const rede = resumirRede(lojas, vendasResumo)
  const linhasModelos = resumirModelos(vendasFiltradas, estoqueFiltrado)
  const lojaSelecionada = lojaDaSelecao(filtro, lojas)
  const blocos = blocosDaAba(aba, lojaSelecionada)

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Painel da Fábrica {MARCA_PAINEL_FABRICA}</h1>
          <p className="text-muted-foreground text-sm">
            Só motos da marca {MARCA_PAINEL_FABRICA}, das {lojas.length} lojas com o portal da fábrica cadastrado.
            Outras marcas não entram.
          </p>
        </div>
        <AcoesPainel
          arquivo={{ nome: planilha.nome, conteudo: paraCsv(planilha.cabecalho, planilha.linhas) }}
          rotuloExportar={`${rotuloDaAba(aba)} (Excel)`}
          urlImpressao={`${ROTA_PAINEL_FABRICA}/imprimir?${urlDoFiltro(filtro, de, ate, aba)}`}
        />
      </div>

      <RedePainel rede={rede} periodo={periodoBr(de, ate)} />

      <nav className="flex gap-1 border-b" aria-label="Abas do painel">
        {ABAS_PAINEL.map(a => (
          <Link
            key={a.id}
            href={`${ROTA_PAINEL_FABRICA}?${urlDoFiltro(filtro, de, ate, a.id)}`}
            aria-current={a.id === aba ? 'page' : undefined}
            className={cn(
              'px-4 py-2 text-sm font-medium border-b-2 -mb-px',
              a.id === aba ? 'border-primary text-primary-text' : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {a.rotulo}
          </Link>
        ))}
      </nav>

      <FiltrosPainel aba={aba} lojas={lojas} modelos={modelos} cores={cores} filtro={filtro} de={de} ate={ate} />
      {aba === 'vendas' && limitado && <p role="status" className="text-sm text-warning">{AVISO_TETO_PERIODO}</p>}

      {blocos.lojaSelecionada && lojaSelecionada && (
        <LojaSelecionadaPainel
          loja={lojaSelecionada}
          faturamento={vendasResumo.valor}
          motos={vendasResumo.total}
        />
      )}
      {blocos.modelos && <ModelosPainel modelos={linhasModelos} />}

      {aba === 'estoque'
        ? <TabelaEstoque lojas={lojas} estoque={estoqueFiltrado} />
        : <TabelaVendas lojas={lojas} vendas={vendasFiltradas} periodo={periodoBr(de, ate)} filtro={filtro} de={de} ate={ate} />}
    </div>
  )
}
