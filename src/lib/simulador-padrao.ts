/**
 * Padrão de cards do simulador, escolhido por grupo na Precificação.
 * - 'taxas': 21x e 12x com a taxa do cartão embutida, para a loja receber o valor mínimo, e PIX.
 * - 'avista_12x': PIX/dinheiro (o valor mínimo) e o total em 12x que o administrador digita
 *   por modelo, sem taxa nenhuma.
 */
import { centavos, centavosParaCima } from './centavos'
import { brutoParaReceber } from './preco-minimo'

export const PADROES_SIMULADOR = ['taxas', 'avista_12x'] as const
export type PadraoSimulador = (typeof PADROES_SIMULADOR)[number]

export const ROTULO_PADRAO: Record<PadraoSimulador, string> = {
  taxas: 'Taxas do cartão',
  avista_12x: 'À vista + 12x fixo',
}

export function ehPadraoSimulador(v: unknown): v is PadraoSimulador {
  return typeof v === 'string' && (PADROES_SIMULADOR as readonly string[]).includes(v)
}

/** O padrão mostra o total em 12x digitado por modelo (campo, coluna e simulador). */
export function usaValor12x(padrao: PadraoSimulador): boolean {
  return padrao === 'avista_12x'
}

/**
 * Total em 12x como vem do campo de moeda ("15600.00"). Vazio ou zero é "sem 12x" (o campo
 * de moeda devolve "0.00" quando o administrador apaga o valor).
 */
export function lerTotal12x(v: string): number | null | 'invalido' {
  const t = v.trim()
  if (!t) return null
  const n = Number(t)
  if (!Number.isFinite(n) || n < 0) return 'invalido'
  return n === 0 ? null : n
}

export type DestaqueAvista12x = {
  pix: number
  /** null: o modelo ainda não tem total em 12x. */
  total12x: number | null
  parcela12x: number | null
  /** Desconto do PIX sobre o total em 12x, em % inteiro; null se não houver ou arredondar a 0. */
  descontoPix: number | null
  economiaPix: number | null
  /** O 12x está igual ou abaixo do PIX: o cliente veria o parcelado mais barato. */
  pixAcimaDo12x: boolean
  /** Frete calculado e os totais com ele; null sem frete. */
  comFrete: { custo: number; pix: number; parcela12x: number | null } | null
}

/** Parcela do total em 12x, em centavos. */
export const parcelaDe12x = (total: number) => centavos(total / 12)

export function destaqueAvista12x(valorMinimo: number, valor12x: number | null, frete: number | null = null): DestaqueAvista12x {
  const total12x = valor12x && valor12x > 0 ? valor12x : null
  const economia = total12x !== null ? centavos(total12x - valorMinimo) : null
  const temEconomia = economia !== null && economia > 0
  const desconto = temEconomia ? Math.round((economia / total12x!) * 100) : 0
  return {
    pix: valorMinimo,
    total12x,
    parcela12x: total12x !== null ? parcelaDe12x(total12x) : null,
    descontoPix: desconto > 0 ? desconto : null,
    economiaPix: temEconomia ? economia : null,
    pixAcimaDo12x: total12x !== null && !temEconomia,
    comFrete: frete === null ? null : {
      custo: frete,
      pix: centavos(valorMinimo + frete),
      parcela12x: total12x !== null ? parcelaDe12x(total12x + frete) : null,
    },
  }
}

/** Linha da tabela de parcelas do padrão 'taxas': total cobrado (credito) e valor de cada parcela. */
export type LinhaDoSimulador = { parcelas: number; credito: number; parcela: number }

/**
 * Como a taxa entra no total. Maquininha (crédito, débito, link): % que a operadora tira do bruto,
 * então o cliente paga saldo / (1 − taxa) (#50). Financiamento: acréscimo que o cliente paga ao banco
 * sobre o saldo, saldo × (1 + taxa).
 */
export type TaxaDoSimulador = 'maquininha' | 'financiamento'

type Cobranca = { credito: number; parcela: number }

const COBRANCA: Record<TaxaDoSimulador, (saldo: number, taxa: number, parcelas: number) => Cobranca | null> = {
  // A parcela sobe ao centavo e o total é a soma das parcelas: o que o cliente paga nunca fica
  // abaixo do bruto que deixa o mínimo para a loja.
  maquininha: (saldo, taxa, parcelas) => {
    const bruto = brutoParaReceber(saldo, taxa)
    if (bruto === null) return null
    const parcela = centavosParaCima(bruto / parcelas)
    return { credito: centavos(parcela * parcelas), parcela }
  },
  financiamento: (saldo, taxa, parcelas) => {
    const credito = saldo * (1 + taxa)
    return { credito, parcela: centavos(credito / parcelas) }
  },
}

/** Uma linha por parcela com taxa cadastrada, sobre o saldo (base menos entrada). */
export function linhasDoSimulador(
  taxas: Record<string, number>, base: number, entrada: number, modo: TaxaDoSimulador,
): LinhaDoSimulador[] {
  const saldo = base - entrada
  return Object.entries(taxas)
    .filter(([, taxa]) => taxa > 0)
    .sort(([a], [b]) => parseInt(a) - parseInt(b))
    .flatMap(([n, taxa]) => {
      const parcelas = parseInt(n)
      const cobranca = COBRANCA[modo](saldo, taxa, parcelas)
      return cobranca === null || cobranca.credito <= 0 ? [] : [{ parcelas, ...cobranca }]
    })
}
