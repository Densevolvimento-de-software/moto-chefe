import { centavos } from './centavos'

export type TaxasVenda = {
  taxasCartao: Record<string, number>
  taxasDebito: Record<string, number>
  taxasLink: Record<string, number>
  taxasFinanciamento: Record<string, number>
}

export type PgtoCalc = {
  tipo: string
  valor: number
  parcelas?: number
}

// Tipos que não têm taxa — vendedor recebe o valor integral
const SEM_TAXA = new Set(['pix', 'dinheiro', 'transferencia', 'financiamento'])

// Tabela de taxa por número de parcelas de cada tipo parcelado (financiamento está em SEM_TAXA)
const TAXA_PARCELADA: Record<string, keyof TaxasVenda> = {
  cartao_credito: 'taxasCartao',
  link_pagamento: 'taxasLink',
}

// A taxa da maquininha é % do valor bruto cobrado (#50). Taxa zero, negativa ou inválida não
// desconta nada; taxa de 100% ou mais não tem valor que a pague.
const taxaValida = (taxa: number) => Number.isFinite(taxa) && taxa > 0

/** O que sobra para a loja de um valor cobrado: bruto × (1 − taxa). Taxa ≥ 100% deixa 0. */
export function liquidoDoBruto(bruto: number, taxa: number): number {
  if (!taxaValida(taxa)) return bruto
  return taxa >= 1 ? 0 : centavos(bruto * (1 - taxa))
}

/** Quanto cobrar para a loja ficar com o líquido: líquido / (1 − taxa). Null se a taxa é ≥ 100%. */
export function brutoParaReceber(liquido: number, taxa: number): number | null {
  if (!taxaValida(taxa)) return liquido
  return taxa >= 1 ? null : centavos(liquido / (1 - taxa))
}

// Líquido que o vendedor recebe de um pagamento (após taxa da operadora/financeira)
function liquidoDePgto(p: PgtoCalc, taxas: TaxasVenda): number {
  const v = p.valor
  if (SEM_TAXA.has(p.tipo)) return v

  if (p.tipo === 'cartao_debito') {
    return liquidoDoBruto(v, taxas.taxasDebito['1'] ?? 0)
  }

  if (!p.parcelas) return 0 // sem parcelas → não calculável → 0 para disparar aviso

  const tabela = TAXA_PARCELADA[p.tipo]
  if (!tabela) return v
  return liquidoDoBruto(v, taxas[tabela][String(p.parcelas)] ?? 0)
}

// Soma do líquido recebido em todos os pagamentos
export function calcLiquidoRecebido(pagamentos: PgtoCalc[], taxas: TaxasVenda): number {
  return centavos(pagamentos.reduce((acc, p) => acc + liquidoDePgto(p, taxas), 0))
}

/** Parcelas (mais de 1) dos pagamentos que pagam taxa parcelada, sem repetir e em ordem: o "12x" do líquido. */
export function parcelasComTaxa(pagamentos: PgtoCalc[]): number[] {
  const parcelas = pagamentos
    .filter(p => Object.hasOwn(TAXA_PARCELADA, p.tipo) && (p.parcelas ?? 0) > 1)
    .map(p => p.parcelas as number)
  return [...new Set(parcelas)].sort((a, b) => a - b)
}

// Verifica se o total é suficiente dado o preço mínimo PIX
export function validarPrecoVenda(
  pagamentos: PgtoCalc[],
  precoMinimoPix: number,
  taxas: TaxasVenda
): { valido: boolean; liquido: number; deficit: number } {
  const liquido = calcLiquidoRecebido(pagamentos, taxas)
  const deficit = Math.max(0, precoMinimoPix - liquido)
  return { valido: deficit < 0.01, liquido, deficit }
}

// Valida a reserva: entrada mínima de 30% do preço PIX
export function validarReserva(
  valorEntrada: number,
  valorTotalVenda: number,
  precoMinimoPix: number
): { entradaOk: boolean; totalOk: boolean; minimoEntrada: number } {
  const minimoEntrada = precoMinimoPix * 0.3
  return {
    entradaOk: valorEntrada >= minimoEntrada - 0.01,
    totalOk: valorTotalVenda >= precoMinimoPix - 0.01,
    minimoEntrada,
  }
}

export function fmtBRL(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}
