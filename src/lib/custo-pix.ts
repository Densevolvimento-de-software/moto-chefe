// Custo do PIX (CONTEXT.md): o banco credita o valor do PIX menos uma porcentagem do grupo.
// A conta é a mesma da taxa de cartão (preco-minimo.ts); aqui ela ganha os nomes do PIX.
import { centavos } from './centavos'
import { brl } from './dashboard-painel'
import { parseNumeroBR } from './numero-br'
import { brutoParaReceber, liquidoDoBruto } from './preco-minimo'

/** O que se grava de um PIX: o valor do PIX, o custo e a taxa (fração), no vínculo (#90) e na forçada (#92). */
export type CustoDoPix = { valorBruto: number; custoPix: number; custoPixTaxa: number }

// As 6 casas da coluna custo_pix_taxa: o banco arredonda assim ao gravar.
const seisCasas = (n: number) => Math.round(n * 1e6) / 1e6

/** Do crédito do banco: o valor do PIX (bruto) e o custo. Taxa de 100% ou mais não tem bruto que pague: fica sem custo. */
export function custoDoPixRecebido(credito: number, taxa: number): { bruto: number; custo: number } {
  const bruto = brutoParaReceber(credito, taxa) ?? credito
  return { bruto, custo: centavos(bruto - credito) }
}

/** Do valor do PIX ao crédito: quanto o banco cobra e quanto entra na conta (o esperado líquido). */
export function creditoDoPix(valor: number, taxa: number): { custo: number; entra: number } {
  const entra = liquidoDoBruto(valor, taxa)
  return { custo: centavos(valor - entra), entra }
}

/** Recusa da tela e do servidor quando o custo do PIX sai da faixa de lerCustoPixTaxa. */
export const CUSTO_PIX_FORA_DA_FAIXA = 'O custo do PIX precisa ser de 0 até menos de 100%'

/**
 * Custo do PIX vindo da tela, em fração (0.002 = 0,20%), já nas 6 casas da coluna: de 0 até menos
 * de 1. Fora disso, null. Arredonda antes de conferir porque o banco arredonda ao gravar.
 */
export function lerCustoPixTaxa(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN
  const naColuna = seisCasas(n)
  return Number.isFinite(naColuna) && naColuna >= 0 && naColuna < 1 ? naColuna : null
}

/** Texto do campo da Precificação, em % no padrão brasileiro ("0,20"), como fração; vazio vale 0. Ilegível ou fora da faixa, null. */
export function custoPixDoCampo(texto: string): number | null {
  if (texto.trim() === '') return 0
  const percentual = parseNumeroBR(texto)
  return percentual === null ? null : lerCustoPixTaxa(percentual / 100)
}

/** Só o PIX tem custo (#86): TED e linha antiga sem tipo entram inteiras. Usado no TS e, como parâmetro, no SQL da busca. */
export const OPERACAO_COM_CUSTO = 'PIX'

/**
 * O que se grava no PIX recebido ao vinculá-lo (#90): o valor do PIX, o custo e a taxa da época.
 * Só PIX tem custo; TED e linha antiga sem tipo entram inteiras (custo 0, taxa 0).
 */
export function custoDoPixVinculado(tipoOperacao: string | null, credito: number, taxa: number): CustoDoPix {
  if (tipoOperacao !== OPERACAO_COM_CUSTO || taxa <= 0) return { valorBruto: credito, custoPix: 0, custoPixTaxa: 0 }
  const { bruto, custo } = custoDoPixRecebido(credito, taxa)
  return { valorBruto: bruto, custoPix: custo, custoPixTaxa: taxa }
}

/** Quanto um PIX de `valor` deve creditar no banco com o custo `taxa` do grupo; null se o grupo não tem custo. */
export function esperadoComTaxa(valor: number, taxa: number): number | null {
  return taxa > 0 ? creditoDoPix(valor, taxa).entra : null
}

/** Recusa do forçar de PIX sem um valor que entrou na conta que se possa ler (#92). */
export const VALOR_RECEBIDO_INVALIDO = 'Informe o valor que entrou na conta'

/** Valor que entrou na conta, digitado no forçar de PIX: só número, em centavos, maior que zero. */
export function lerValorRecebido(v: unknown): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null
  const emCentavos = centavos(v)
  return emCentavos > 0 ? emCentavos : null
}

/**
 * O que se grava na marca da forçada de um PIX (#92), a partir do que o pagamento esperava (`base`: o valor
 * do pagamento, ou o que faltava) e do que entrou. Decisão do Luis registrada na #92: custo = base − recebido,
 * nunca negativo. A taxa gravada é a efetiva (custo ÷ base), escolha da implementação; a do grupo não entra aqui.
 */
export function custoDoPixForcado(base: number, recebido: number): CustoDoPix {
  const custoPix = Math.max(0, centavos(base - recebido))
  return { valorBruto: base, custoPix, custoPixTaxa: base > 0 ? seisCasas(custoPix / base) : 0 }
}

/** Custo do PIX em porcentagem, como a tela mostra: "0,20%", "0,2998%". */
export const percentualDoPix = (taxa: number) =>
  `${(taxa * 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}%`

// Acima disso o custo da forçada costuma ser erro de digitação no valor que entrou (decisão do Luis registrada na #92).
const CUSTO_ALTO_NA_FORCADA = 0.01

/** Aviso (não bloqueia) quando o custo da forçada de PIX passa de 1% do que o pagamento esperava. */
export function avisoDeCustoAlto(custo: CustoDoPix, taxaDoGrupo: number): string | null {
  if (custo.custoPixTaxa <= CUSTO_ALTO_NA_FORCADA) return null
  return `Custo de ${percentualDoPix(custo.custoPixTaxa)} bem acima do custo do PIX do grupo (${percentualDoPix(taxaDoGrupo)}). Confira o valor que entrou.`
}

/**
 * O pedido da venda: valor bruto dos PIX com custo ligados a ele (do grupo da loja) e a base das forçadas de PIX de
 * todas as vendas dele. O SQL do líquido (`queries/valor-liquido.ts`) faz a mesma conta.
 */
export type CoberturaDoPedido = { pixDoPedido: number; forcadasDoPedido: number }

/**
 * Quanto do custo gravado na forçada de PIX conta no líquido (decisão 10 do Luis, #93): a parte que o PIX do pedido
 * cobre já leva o custo dele e não conta de novo. Desvinculado o PIX, volta a contar inteiro.
 */
export function custoDaForcadaQueConta(custoGravado: number, c: CoberturaDoPedido): { conta: number; coberto: number } {
  const [custo, p, f] = [custoGravado, c.pixDoPedido, c.forcadasDoPedido].map(v => Math.round(v * 100))
  // custo × (1 − p/f) em centavos inteiros, meio centavo para cima: a mesma conta do SQL, sem resto de ponto flutuante.
  const conta = p <= 0 || f <= 0 ? custo : p >= f ? 0 : Math.floor((2 * custo * (f - p) + f) / (2 * f))
  return { conta: conta / 100, coberto: (custo - conta) / 100 }
}

/** A linha da forçada na aba Pagamento (decisão 11 do Luis, #93): o custo que conta e a parte do PIX do pedido. */
export function textoDoCustoDaForcada({ conta, coberto }: { conta: number; coberto: number }): string | null {
  if (conta === 0 && coberto === 0) return null
  if (conta === 0) return 'Custo já entra pelo PIX do pedido'
  if (coberto === 0) return `Custo do PIX ${brl(conta)}`
  return `Custo do PIX ${brl(conta)} (${brl(coberto)} já entra pelo PIX do pedido)`
}
