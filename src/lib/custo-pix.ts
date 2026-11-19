// Custo do PIX (CONTEXT.md): o banco credita o valor do PIX menos uma porcentagem do grupo.
// A conta é a mesma da taxa de cartão (preco-minimo.ts); aqui ela ganha os nomes do PIX.
import { centavos } from './centavos'
import { parseNumeroBR } from './numero-br'
import { brutoParaReceber, liquidoDoBruto } from './preco-minimo'

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
  const naColuna = Math.round(n * 1e6) / 1e6
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
export function custoDoPixVinculado(tipoOperacao: string | null, credito: number, taxa: number): { valorBruto: number; custoPix: number; custoPixTaxa: number } {
  if (tipoOperacao !== OPERACAO_COM_CUSTO || taxa <= 0) return { valorBruto: credito, custoPix: 0, custoPixTaxa: 0 }
  const { bruto, custo } = custoDoPixRecebido(credito, taxa)
  return { valorBruto: bruto, custoPix: custo, custoPixTaxa: taxa }
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
 * do pagamento, ou o que faltava) e do que entrou. Decisão do Luis (19/11/2026): custo = base − recebido,
 * nunca negativo; a taxa gravada é a efetiva (custo ÷ base). A taxa do grupo não entra aqui.
 */
export function custoDoPixForcado(base: number, recebido: number): { valorBruto: number; custoPix: number; custoPixTaxa: number } {
  const custoPix = Math.max(0, centavos(base - recebido))
  return { valorBruto: base, custoPix, custoPixTaxa: base > 0 ? Math.round((custoPix / base) * 1e6) / 1e6 : 0 }
}
