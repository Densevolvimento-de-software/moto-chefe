// ─── Painel da Fábrica MotoChefe ──────────────────────────────────────────────
// Visão da plataforma para a fábrica: estoque e vendas de TODAS as lojas MotoChefe
// do MOVA, de todas as Contas, mas só de motos da marca MotoChefe. Moto de outra
// marca (Voi etc.) nunca entra, nem que esteja numa loja MotoChefe.
//
// Quem é "loja MotoChefe": a loja ativa que tem o login do portal da fábrica
// cadastrado (`lojas.fabrica_email`, motochefebrasil.store). É o cadastro que liga a
// loja à fábrica; sem ele a loja não compra da MotoChefe. A regra de SQL mora em
// @/lib/queries/painel-fabrica, e as duas pontas (marca e loja) num lugar só.
//
// O que a fábrica vê de cada venda (decisão do Luis, #892, revista em 17/11 no #30): só data,
// número, loja, modelo, cor, chassi e o valor da moto. Os tipos abaixo só têm isso; o id da
// loja serve só para filtrar pela URL e não aparece na tela, no Excel nem no impresso.
//
// Este arquivo é puro (sem banco): filtro, totais e planilha, usados pela tela e testados.
import { diaBrt, periodoDoMesBrt } from '@/lib/data-venda'
import { addDias } from '@/lib/calendario'
import { centavos } from '@/lib/centavos'

export const ROTA_PAINEL_FABRICA = '/fabrica'

/** Marca da fábrica. Comparada sem caixa, espaço nem acento: "MotoChefe", "MOTO CHEFE". */
export const MARCA_PAINEL_FABRICA = 'MotoChefe'

const chaveMarca = (m: string) => m.normalize('NFD').replace(/[^a-zA-Z]/g, '').toLowerCase()

/** Mesma regra do SQL `marcaDoPainel()`: só letras, minúsculas. */
export function ehMarcaDoPainel(marca: string | null | undefined): boolean {
  return !!marca && chaveMarca(marca) === chaveMarca(MARCA_PAINEL_FABRICA)
}

export type LojaPainel = { lojaId: string; lojaNome: string }

export type LinhaEstoquePainel = {
  lojaId: string
  modelo: string
  cor: string
  quantidade: number
}

/** Uma moto vendida. */
export type VendaPainel = {
  /** ISO, em UTC; exibir pelo dia de Brasília. */
  data: string
  numero: number
  lojaId: string
  modelo: string
  cor: string
  chassi: string
  /** Valor da moto em reais, bruto (sem descontar taxa de cartão): a base do faturamento. */
  valor: number
}

/** Abas do painel, na ordem da tela; a 1ª é a padrão. */
export const ABAS_PAINEL = [{ id: 'estoque', rotulo: 'Estoque' }, { id: 'vendas', rotulo: 'Vendas' }] as const
export type Aba = (typeof ABAS_PAINEL)[number]['id']
export const abaDaUrl = (v: unknown): Aba => ABAS_PAINEL.find(a => a.id === v)?.id ?? ABAS_PAINEL[0].id
export const rotuloDaAba = (aba: Aba) => ABAS_PAINEL.find(a => a.id === aba)?.rotulo ?? aba

/** Colunas da lista de vendas: as mesmas na tela, no impresso e no Excel. */
export const COLUNAS_VENDAS = ['Data', 'Venda', 'Loja', 'Modelo', 'Cor', 'Chassi', 'Valor da moto'] as const

/** Célula em reais: a tela e o impresso mostram "R$ 9.990,00"; o Excel recebe o número com 2 casas. */
export type Reais = { reais: number }
export type Celula = string | number | Reais

/** Nome da loja pelo id; vazio se a loja não está na lista. */
export function nomeDaLoja(lojas: LojaPainel[]): (lojaId: string) => string {
  const nomes = new Map(lojas.map(l => [l.lojaId, l.lojaNome]))
  return lojaId => nomes.get(lojaId) ?? ''
}

/**
 * Células de uma venda, na ordem de COLUNAS_VENDAS: a tela, o impresso e o Excel leem daqui.
 * Só a data: a venda é digitada sem hora (parseDataInput grava meio-dia UTC), então a hora
 * mostraria 09:00 em quase todas (decisão do Luis, #899).
 */
export function celulasDaVenda(v: VendaPainel, nomeLoja: (lojaId: string) => string): Celula[] {
  return [diaBrt(v.data), v.numero, nomeLoja(v.lojaId), v.modelo, v.cor, v.chassi, { reais: v.valor }]
}

/** "0001": o fim do chassi, que basta para achar a moto na lista do celular. */
export const finalDoChassi = (chassi: string): string => chassi.slice(-4)

/** Lista vazia = sem filtro (tudo). */
export type FiltroPainel = { lojas: string[]; modelos: string[]; cores: string[] }

export const FILTRO_VAZIO: FiltroPainel = { lojas: [], modelos: [], cores: [] }

type ParamUrl = string | string[] | undefined
/** O que a tela e o impresso leem da URL. */
export type ParamsPainel = { aba?: string; de?: string; ate?: string; loja?: ParamUrl; modelo?: ParamUrl; cor?: ParamUrl }
const lista = (v: ParamUrl) => (Array.isArray(v) ? v : v ? [v] : []).map(s => s.trim()).filter(Boolean)

/** Filtro a partir da URL (`?loja=..&loja=..&modelo=..&cor=..`): a tela e o impresso leem igual. */
export function filtroDaUrl(p: { loja?: ParamUrl; modelo?: ParamUrl; cor?: ParamUrl }): FiltroPainel {
  return { lojas: lista(p.loja), modelos: lista(p.modelo), cores: lista(p.cor) }
}

/** Query string da aba, do filtro e do período (links das abas, da loja e do impresso). */
export function urlDoFiltro(f: FiltroPainel, de: string, ate: string, aba: Aba): string {
  const q = new URLSearchParams({ aba, de, ate })
  f.lojas.forEach(v => q.append('loja', v))
  f.modelos.forEach(v => q.append('modelo', v))
  f.cores.forEach(v => q.append('cor', v))
  return q.toString()
}

/** Opções dos filtros: tudo o que existe no painel, sem o filtro aplicado. */
export function opcoesDoPainel(estoque: LinhaEstoquePainel[], vendas: VendaPainel[]) {
  const ordena = (s: Set<string>) => [...s].sort(ordemPt)
  return {
    modelos: ordena(new Set([...estoque.map(l => l.modelo), ...vendas.map(l => l.modelo)])),
    cores: ordena(new Set([...estoque.map(l => l.cor), ...vendas.map(l => l.cor)])),
  }
}

const passa = (lista: string[], valor: string) => lista.length === 0 || lista.includes(valor)
const passaNoFiltro = (f: FiltroPainel, l: { lojaId: string; modelo: string; cor: string }) =>
  passa(f.lojas, l.lojaId) && passa(f.modelos, l.modelo) && passa(f.cores, l.cor)

export function filtrarEstoque(linhas: LinhaEstoquePainel[], f: FiltroPainel): LinhaEstoquePainel[] {
  return linhas.filter(l => passaNoFiltro(f, l))
}

/** Vendas do filtro, da mais recente para a mais antiga (empate: número maior primeiro). */
export function filtrarVendas(vendas: VendaPainel[], f: FiltroPainel): VendaPainel[] {
  return vendas.filter(v => passaNoFiltro(f, v)).sort((a, b) => b.data.localeCompare(a.data) || b.numero - a.numero)
}

const ordemPt = (a: string, b: string) => a.localeCompare(b, 'pt-BR')

export type ModeloCor = { modelo: string; cor: string; quantidade: number }
export type Subtotal = { chave: string; quantidade: number }

/** Estoque somado por modelo × cor (todas as lojas do filtro), por modelo e por loja. */
export function resumirEstoque(linhas: LinhaEstoquePainel[]) {
  const porModeloCor = new Map<string, ModeloCor>()
  const porModelo = new Map<string, number>()
  const porLoja = new Map<string, number>()
  let total = 0
  for (const l of linhas) {
    const k = `${l.modelo}\u0000${l.cor}`
    const atual = porModeloCor.get(k)
    if (atual) atual.quantidade += l.quantidade
    else porModeloCor.set(k, { modelo: l.modelo, cor: l.cor, quantidade: l.quantidade })
    porModelo.set(l.modelo, (porModelo.get(l.modelo) ?? 0) + l.quantidade)
    porLoja.set(l.lojaId, (porLoja.get(l.lojaId) ?? 0) + l.quantidade)
    total += l.quantidade
  }
  return {
    modeloCor: [...porModeloCor.values()].sort((a, b) => ordemPt(a.modelo, b.modelo) || ordemPt(a.cor, b.cor)),
    porModelo: [...porModelo].map(([chave, quantidade]) => ({ chave, quantidade })).sort((a, b) => ordemPt(a.chave, b.chave)),
    porLoja: [...porLoja].map(([chave, quantidade]) => ({ chave, quantidade })),
    total,
  }
}

const resumirPor = <T, R>(itens: T[], chave: (i: T) => string, resumo: (grupo: T[]) => R) =>
  new Map([...Map.groupBy(itens, chave)].map(([k, grupo]) => [k, resumo(grupo)]))
const contarPor = <T>(itens: T[], chave: (i: T) => string) => resumirPor(itens, chave, grupo => grupo.length)
const somarValores = (vendas: VendaPainel[]) => centavos(vendas.reduce((soma, v) => soma + v.valor, 0))

/**
 * Matriz loja × modelo e faturamento a partir das vendas uma a uma: a soma sempre bate com a
 * lista, e o filtro vale para os totais porque eles somam só as vendas que chegam.
 */
export function resumirVendas(vendas: VendaPainel[]) {
  const celulas = contarPor(vendas, v => `${v.lojaId}\u0000${v.modelo}`)
  const porModelo = contarPor(vendas, v => v.modelo)
  return {
    celula: (lojaId: string, modelo: string) => celulas.get(`${lojaId}\u0000${modelo}`) ?? 0,
    porLoja: contarPor(vendas, v => v.lojaId),
    porModelo,
    modelos: [...porModelo.keys()].sort(ordemPt),
    total: vendas.length,
    valorPorLoja: resumirPor(vendas, v => v.lojaId, somarValores),
    valor: somarValores(vendas),
  }
}

export type ResumoVendas = ReturnType<typeof resumirVendas>
export type LojaComVenda = LojaPainel & { motos: number; valor: number }

/** Lojas que venderam no filtro, com motos e faturamento: da que mais vendeu motos, empate pelo nome. */
export function lojasComVendas(lojas: LojaPainel[], r: ResumoVendas): LojaComVenda[] {
  return lojas
    .map(l => ({ ...l, motos: r.porLoja.get(l.lojaId) ?? 0, valor: r.valorPorLoja.get(l.lojaId) ?? 0 }))
    .filter(l => l.motos > 0)
    .sort((a, b) => b.motos - a.motos || ordemPt(a.lojaNome, b.lojaNome))
}

/** As mesmas lojas, do maior faturamento para o menor (faixa "Ver por loja"); empate pelo nome. */
export const lojasPorFaturamento = (lojas: LojaComVenda[]): LojaComVenda[] =>
  [...lojas].sort((a, b) => b.valor - a.valor || ordemPt(a.lojaNome, b.lojaNome))

export type Planilha = { nome: string; cabecalho: string[]; linhas: Celula[][] }

/**
 * Planilha da aba aberta, com as mesmas colunas da tela: só o que a fábrica pode ver
 * (sem cidade, empresa nem id). Vendas na ordem recebida (a da tela).
 */
export function planilhaDoPainel(aba: Aba, d: {
  lojas: LojaPainel[]
  estoque: LinhaEstoquePainel[]
  vendas: VendaPainel[]
  de: string
  ate: string
  /** hojeBrt(), de quem chama: nome do arquivo do estoque. */
  hoje: string
}): Planilha {
  const loja = nomeDaLoja(d.lojas)
  if (aba === 'vendas') {
    return {
      nome: `vendas-motochefe-${d.de}-a-${d.ate}.csv`,
      cabecalho: [...COLUNAS_VENDAS],
      linhas: d.vendas.map(v => celulasDaVenda(v, loja)),
    }
  }
  return {
    nome: `estoque-motochefe-${d.hoje}.csv`,
    cabecalho: ['Loja', 'Modelo', 'Cor', 'Quantidade'],
    linhas: d.estoque
      .map(l => [loja(l.lojaId), l.modelo, l.cor, l.quantidade])
      .sort((a, b) => a.slice(0, 3).join('|').localeCompare(b.slice(0, 3).join('|'), 'pt-BR')),
  }
}

/**
 * CSV que o Excel em português abre direto: separador `;`, BOM UTF-8, número com vírgula
 * decimal (reais sempre com 2 casas) e aspas em todo campo com `;`, aspas ou quebra de linha. Campo que começa com
 * = + - @ ganha um apóstrofo, para o Excel não executar fórmula vinda de nome de loja ou modelo.
 */
export function paraCsv(cabecalho: string[], linhas: Celula[][]): string {
  const campo = (v: Celula) => {
    if (typeof v === 'object') return v.reais.toFixed(2).replace('.', ',')
    if (typeof v === 'number') return String(v).replace('.', ',')
    const s = /^[=+\-@]/.test(v) ? `'${v}` : v
    return /[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  return '﻿' + [cabecalho, ...linhas].map(l => l.map(campo).join(';')).join('\r\n') + '\r\n'
}

// ─── Período da aba Vendas ────────────────────────────────────────────────────
// Teto de 92 dias (decisão do Luis, 14/11, #901): o período vai inteiro para a tela, o payload
// e o Excel a cada carga. Vale para todos, na tela e no servidor.
export const TETO_PERIODO_DIAS = 92
export const AVISO_TETO_PERIODO = `Período limitado a ${TETO_PERIODO_DIAS} dias`

export type PeriodoPainel = { de: string; ate: string; limitado: boolean }

/** Período da URL em dias de Brasília. Início depois do fim: o mês corrente. Acima do teto: corta o início. */
export function periodoDoPainel(params: { de?: string; ate?: string }, agora: Date = new Date()): PeriodoPainel {
  const pedido = periodoDoMesBrt(params, agora)
  const { de, ate } = pedido.de <= pedido.ate ? pedido : periodoDoMesBrt({}, agora)
  const inicioMinimo = addDias(ate, -(TETO_PERIODO_DIAS - 1))
  return de < inicioMinimo ? { de: inicioMinimo, ate, limitado: true } : { de, ate, limitado: false }
}

/** Números da rede no topo da tela, no filtro: lojas com venda nele (não a lista toda) e a média por essas lojas. */
export type RedePainel = { lojasComVenda: number; motos: number; valor: number; mediaPorLoja: number }

export function resumirRede(lojas: LojaPainel[], r: ResumoVendas): RedePainel {
  const lojasComVenda = lojasComVendas(lojas, r).length
  const mediaPorLoja = lojasComVenda > 0 ? centavos(r.valor / lojasComVenda) : 0
  return { lojasComVenda, motos: r.total, valor: r.valor, mediaPorLoja }
}

/** Um modelo na tabela "Vendas e estoque por modelo": vendidas, receita, preço médio e estoque. */
export type ModeloPainel = { modelo: string; vendidas: number; receita: number; precoMedio: number; emEstoque: number }

/**
 * Vendas e estoque por modelo, no filtro: modelo com venda ou com estoque entra, em ordem de nome.
 * Preço médio = receita ÷ motos vendidas (zero sem venda, sem divisão por zero).
 */
export function resumirModelos(vendas: VendaPainel[], estoque: LinhaEstoquePainel[]): ModeloPainel[] {
  const porModeloVendas = contarPor(vendas, v => v.modelo)
  const receitaPorModelo = resumirPor(vendas, v => v.modelo, somarValores)
  const emEstoque = resumirEstoque(estoque).porModelo
  const modelos = [...new Set([...porModeloVendas.keys(), ...emEstoque.map(p => p.chave)])].sort(ordemPt)
  return modelos.map(modelo => {
    const vendidas = porModeloVendas.get(modelo) ?? 0
    const receita = receitaPorModelo.get(modelo) ?? 0
    return {
      modelo,
      vendidas,
      receita,
      precoMedio: vendidas > 0 ? centavos(receita / vendidas) : 0,
      emEstoque: emEstoque.find(p => p.chave === modelo)?.quantidade ?? 0,
    }
  })
}

/** A loja da tela "Loja selecionada": só quando o filtro tem exatamente uma loja da lista. */
export function lojaDaSelecao(filtro: FiltroPainel, lojas: LojaPainel[]): LojaPainel | null {
  if (filtro.lojas.length !== 1) return null
  return lojas.find(l => l.lojaId === filtro.lojas[0]) ?? null
}

/** Quais blocos aparecem em cada aba: modelos nas duas; loja selecionada só em Vendas, com uma loja no filtro. */
export function blocosDaAba(aba: Aba, lojaSelecionada: LojaPainel | null): { lojaSelecionada: boolean; modelos: boolean } {
  return { lojaSelecionada: aba === 'vendas' && lojaSelecionada !== null, modelos: true }
}
