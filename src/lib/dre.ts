// Demonstração do Resultado — a aritmética do /financeiro aberta em linhas.
//
// O RESULTADO OPERACIONAL daqui é, por construção, o mesmo "Lucro Líquido" que o
// /financeiro mostra: receita bruta − taxas − custo das motos − despesas
// operacionais. Duas telas do mesmo mês discordando é pior que qualquer uma das
// duas, então o DRE não recalcula nada por conta própria — só mostra o meio.
//
// Duas escolhas que fogem do livro-texto, de propósito:
//
//   Taxa de cartão entra como dedução da receita. Contabilmente é despesa
//   financeira, mas é assim que o Financeiro calcula desde sempre, e alinhar as
//   duas telas vale mais que a etiqueta correta.
//
//   Imposto fica DENTRO das despesas operacionais (grupo Tributos), não como
//   dedução da receita bruta. No sistema o imposto entra pelo extrato quando é
//   pago, não estimado por alíquota sobre cada venda — descontar nos dois lugares
//   contaria o mesmo tributo duas vezes.
import { centavos } from './centavos'

export const GRUPOS_DRE = [
  { valor: 'pessoal',         rotulo: 'Pessoal' },
  { valor: 'ocupacao',        rotulo: 'Ocupação' },
  { valor: 'comerciais',      rotulo: 'Comerciais' },
  { valor: 'administrativas', rotulo: 'Administrativas' },
  { valor: 'logistica',       rotulo: 'Logística e Veículos' },
  { valor: 'tributos',        rotulo: 'Tributos e Taxas' },
  { valor: 'oficina',         rotulo: 'Oficina' },
  { valor: 'outras',          rotulo: 'Outras' },
] as const

export type GrupoDre = (typeof GRUPOS_DRE)[number]['valor']

const VALIDOS = new Set<string>(GRUPOS_DRE.map(g => g.valor))

/**
 * Categoria sem grupo cadastrado cai em "Outras" em vez de sumir. Um total que
 * não fecha por falta de cadastro é pior do que uma linha genérica: o primeiro
 * ninguém percebe, a segunda salta aos olhos.
 */
export function grupoOuOutras(valor: string | null | undefined): GrupoDre {
  return valor && VALIDOS.has(valor) ? (valor as GrupoDre) : 'outras'
}

export function rotuloGrupo(valor: string): string {
  return GRUPOS_DRE.find(g => g.valor === valor)?.rotulo ?? valor
}

export type EntradaDre = {
  receitaMotos: number
  receitaServicos: number
  receitaPecas: number
  /** Já é um número positivo; a linha o mostra como dedução. */
  taxasCartao: number
  /** Tarifa do Pix da maquininha Mercado Pago (#51): dedução própria, fora das taxas de cartão. */
  tarifaPix: number
  /** Custo do PIX do banco nas vendas de moto (#93): dedução própria, fora das taxas de cartão. */
  custoPix: number
  /** Custo das motos vendidas. Peça e serviço não têm custo cadastrado. */
  cmvMotos: number
  despesasPorGrupo: Partial<Record<GrupoDre, number>>
  /** Fora do resultado: existe para o total do mês fechar com o extrato. */
  memorando?: {
    retiradasSocios?: number
    compraMercadoria?: number
    transferenciasInternas?: number
    estornosCliente?: number
  }
}

export type TipoLinha = 'receita' | 'deducao' | 'subtotal' | 'despesa' | 'resultado' | 'memo'

export type LinhaDre = {
  /** Estável entre colunas — é o que permite zipar loja a loja. */
  chave: string
  rotulo: string
  tipo: TipoLinha
  /** 1 = detalhe recuado sob a linha anterior. */
  nivel: 0 | 1
  valor: number
  /** Análise vertical: quanto a linha vale sobre a receita líquida. */
  percentual: number
}

/**
 * Sempre devolve o MESMO conjunto de linhas, na mesma ordem, mesmo quando o valor
 * é zero: a visão por loja zipa as colunas pela chave, e linha que aparece numa
 * coluna e some na outra desalinha a tabela inteira.
 */
export function montarDre(e: EntradaDre): LinhaDre[] {
  const receitaBruta = e.receitaMotos + e.receitaServicos + e.receitaPecas
  const receitaLiquida = receitaBruta - e.taxasCartao - e.tarifaPix - e.custoPix
  const lucroBruto = receitaLiquida - e.cmvMotos
  const totalDespesas = GRUPOS_DRE.reduce((s, g) => s + (e.despesasPorGrupo[g.valor] ?? 0), 0)
  const resultado = lucroBruto - totalDespesas

  // Base da análise vertical. Zero receita (o recorte Geral, por exemplo) daria
  // divisão por zero — aí o percentual é 0 e a coluna vira só valores.
  const base = receitaLiquida
  const pct = (v: number) => (base > 0 ? (v / base) * 100 : 0)

  const linha = (
    chave: string, rotulo: string, tipo: TipoLinha, nivel: 0 | 1, valor: number,
  ): LinhaDre => ({ chave, rotulo, tipo, nivel, valor, percentual: pct(valor) })

  const linhas: LinhaDre[] = [
    linha('receita_bruta',     'RECEITA BRUTA',        'subtotal', 0, receitaBruta),
    linha('receita_motos',     'Motos',                'receita',  1, e.receitaMotos),
    linha('receita_servicos',  'Serviços (OS)',        'receita',  1, e.receitaServicos),
    linha('receita_pecas',     'Peças',                'receita',  1, e.receitaPecas),
    linha('taxas_cartao',      '(−) Taxas de cartão',  'deducao',  0, e.taxasCartao),
    linha('tarifa_pix',        '(−) Tarifa do PIX na maquininha', 'deducao', 0, e.tarifaPix),
    linha('custo_pix',         '(−) Custo do PIX',     'deducao',  0, e.custoPix),
    linha('receita_liquida',   'RECEITA LÍQUIDA',      'subtotal', 0, receitaLiquida),
    linha('cmv',               '(−) CMV — motos',      'deducao',  0, e.cmvMotos),
    linha('lucro_bruto',       'LUCRO BRUTO',          'subtotal', 0, lucroBruto),
    ...GRUPOS_DRE.map(g =>
      linha(`despesa_${g.valor}`, `(−) ${g.rotulo}`, 'despesa', 1, e.despesasPorGrupo[g.valor] ?? 0),
    ),
    linha('despesas_total',    '(−) DESPESAS OPERACIONAIS', 'deducao', 0, totalDespesas),
    linha('resultado',         'RESULTADO OPERACIONAL', 'resultado', 0, resultado),
  ]

  // O memorando sai sempre, zerado quando não há nada: o conjunto de linhas
  // precisa ser o mesmo em toda coluna, e "não informado" e "zero" dão na mesma
  // para quem lê um demonstrativo.
  const m = e.memorando
  linhas.push(
    linha('memo_retiradas',      'Retiradas de sócios',        'memo', 1, m?.retiradasSocios ?? 0),
    linha('memo_mercadoria',     'Compra de mercadoria',       'memo', 1, m?.compraMercadoria ?? 0),
    linha('memo_transferencias', 'Transferências internas',    'memo', 1, m?.transferenciasInternas ?? 0),
    linha('memo_estornos',       'Estornos a cliente',         'memo', 1, m?.estornosCliente ?? 0),
  )

  return linhas
}

/**
 * Taxas da receita em linhas separadas. O bruto − líquido das motos inclui a tarifa do Pix da maquininha
 * Mercado Pago (#51) e o custo do PIX do banco (#93), que a consulta de vendas devolve à parte e saem daqui para
 * as linhas próprias; as outras receitas (OS e peça) já chegam divididas. A soma das linhas é o bruto − líquido.
 */
export function taxasDaReceita(p: {
  brutoMotos: number
  liquidoMotos: number
  tarifaPixMotos: number
  taxaCartaoOutras: number
  tarifaPixOutras: number
  custoPixMotos: number
  /** Custo do PIX do banco de OS e venda de peça (#94); fica fora do bruto − líquido delas, que é só da conciliação de cartão. */
  custoPixOutras: number
}): { taxasCartao: number; tarifaPix: number; custoPix: number } {
  // Centavos: a subtração em ponto flutuante deixa resíduo (−1e−13) que a tela mostraria como "−R$ 0,00";
  // o + 0 troca o −0 do arredondamento por 0.
  const emCentavos = (v: number) => centavos(v) + 0
  return {
    taxasCartao: emCentavos(p.brutoMotos - p.liquidoMotos - p.tarifaPixMotos - p.custoPixMotos + p.taxaCartaoOutras),
    tarifaPix: emCentavos(p.tarifaPixMotos + p.tarifaPixOutras),
    custoPix: emCentavos(p.custoPixMotos + p.custoPixOutras),
  }
}

/** Soma duas entradas — usado para a coluna TOTAL e para consolidar meses. */
export function somarEntradas(a: EntradaDre, b: EntradaDre): EntradaDre {
  const despesasPorGrupo: Partial<Record<GrupoDre, number>> = {}
  for (const g of GRUPOS_DRE) {
    const soma = (a.despesasPorGrupo[g.valor] ?? 0) + (b.despesasPorGrupo[g.valor] ?? 0)
    if (soma !== 0) despesasPorGrupo[g.valor] = soma
  }
  return {
    receitaMotos:    a.receitaMotos + b.receitaMotos,
    receitaServicos: a.receitaServicos + b.receitaServicos,
    receitaPecas:    a.receitaPecas + b.receitaPecas,
    taxasCartao:     a.taxasCartao + b.taxasCartao,
    tarifaPix:       a.tarifaPix + b.tarifaPix,
    custoPix:        a.custoPix + b.custoPix,
    cmvMotos:        a.cmvMotos + b.cmvMotos,
    despesasPorGrupo,
    memorando: {
      retiradasSocios:        (a.memorando?.retiradasSocios ?? 0) + (b.memorando?.retiradasSocios ?? 0),
      compraMercadoria:       (a.memorando?.compraMercadoria ?? 0) + (b.memorando?.compraMercadoria ?? 0),
      transferenciasInternas: (a.memorando?.transferenciasInternas ?? 0) + (b.memorando?.transferenciasInternas ?? 0),
      estornosCliente:        (a.memorando?.estornosCliente ?? 0) + (b.memorando?.estornosCliente ?? 0),
    },
  }
}

export const ENTRADA_VAZIA: EntradaDre = {
  receitaMotos: 0, receitaServicos: 0, receitaPecas: 0,
  taxasCartao: 0, tarifaPix: 0, custoPix: 0, cmvMotos: 0, despesasPorGrupo: {},
  memorando: {},
}

// ─── Matriz: as mesmas linhas, várias colunas ────────────────────────────────

export type ColunaMatriz = { chave: string; rotulo: string; entrada: EntradaDre }

export type LinhaMatriz = {
  chave: string
  rotulo: string
  tipo: TipoLinha
  nivel: 0 | 1
  /** Um por coluna, na ordem em que as colunas entraram. */
  valores: number[]
  percentuais: number[]
}

/**
 * Zipa as colunas linha a linha, pela chave. Funciona porque montarDre devolve
 * sempre o mesmo conjunto de linhas: se alguma coluna pudesse omitir uma, a
 * tabela sairia com valor de aluguel na linha de energia.
 */
export function montarMatriz(colunas: ColunaMatriz[]): LinhaMatriz[] {
  if (colunas.length === 0) return []
  const porColuna = colunas.map(c => montarDre(c.entrada))
  return porColuna[0].map((modelo, i) => ({
    chave: modelo.chave,
    rotulo: modelo.rotulo,
    tipo: modelo.tipo,
    nivel: modelo.nivel,
    valores: porColuna.map(linhas => linhas[i].valor),
    percentuais: porColuna.map(linhas => linhas[i].percentual),
  }))
}

// Os subtotais do DRE em caixa alta; no resumo do fechamento, com a escrita da tela.
const ROTULO_NO_RESUMO: Record<string, string> = {
  receita_bruta: 'Receita bruta', receita_liquida: 'Receita líquida', lucro_bruto: 'Lucro bruto',
  despesas_total: '(−) Despesas operacionais', resultado: 'Resultado operacional',
}

/**
 * O DRE resumido do fechamento (#93): as linhas de primeiro nível do DRE, na ordem dele, sem o memorando. Sai das
 * linhas e não de uma lista à mão, para nenhuma dedução nova (tarifa do PIX, custo do PIX) ficar de fora da conta.
 */
export function dreResumido(linhas: LinhaDre[]) {
  return linhas
    .filter(l => l.nivel === 0 && l.tipo !== 'memo')
    .map(l => ({ chave: l.chave, rotulo: ROTULO_NO_RESUMO[l.chave] ?? l.rotulo, deducao: l.tipo === 'deducao', valor: l.valor }))
}
