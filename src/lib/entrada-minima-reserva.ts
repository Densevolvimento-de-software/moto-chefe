import { centavos } from './centavos'
import { fmtBRL } from './preco-minimo'
import { ehUuid } from './uuid'

// O padrão das lojas é o que já valia, fixo, antes de a porcentagem virar dado da loja (#283).
export const ENTRADA_MINIMA_PADRAO_PCT = 30

/** Menor entrada da reserva: a porcentagem da loja sobre o preço mínimo PIX do modelo. */
export const minimoDaEntrada = (precoMinimoPix: number, pct: number) => centavos((precoMinimoPix * pct) / 100)

/**
 * A reserva respeita a entrada mínima da loja da moto? Tela e servidor usam esta mesma conta.
 * `totalOk` é só aviso (ADR-0011): não depende da porcentagem.
 */
export function validarReserva(
  valorEntrada: number,
  valorTotalVenda: number,
  precoMinimoPix: number,
  entradaMinimaPct: number,
): { entradaOk: boolean; totalOk: boolean; minimoEntrada: number } {
  const minimoEntrada = minimoDaEntrada(precoMinimoPix, entradaMinimaPct)
  return {
    // Folga de um centavo; em centavos para o ponto flutuante não decidir o último centavo.
    entradaOk: centavos(minimoEntrada - valorEntrada) <= 0.01,
    totalOk: valorTotalVenda >= precoMinimoPix - 0.01,
    minimoEntrada,
  }
}

/** Recusa do servidor. */
export const fraseEntradaMinimaServidor = (minimo: number, pct: number, precoPix: number) =>
  `Entrada mínima de ${fmtBRL(minimo)} (${pct}% do preço PIX ${fmtBRL(precoPix)})`

/** Texto do diálogo de reserva. */
export const fraseEntradaMinimaTela = (minimo: number, pct: number) =>
  `Mínimo de ${fmtBRL(minimo)} (${pct}% do preço PIX)`

/** Porcentagem vinda da tela: inteiro de 0 a 100. Fracionária, texto, fora da faixa: null. */
export function lerEntradaMinimaPct(v: unknown): number | null {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 100 ? v : null
}

/** Texto do campo da tela: só dígitos (o "2,5" e o "1e2" não passam), com a mesma faixa. */
export function entradaMinimaPctDoCampo(texto: string): number | null {
  const limpo = texto.trim()
  return /^\d{1,3}$/.test(limpo) ? lerEntradaMinimaPct(Number(limpo)) : null
}

export type EntradaMinimaDaLoja = { lojaId: string; pct: number }

/**
 * Pedido de gravação: lista de pares loja e porcentagem, sem loja repetida. Devolve objetos novos
 * só com os dois campos (o que mais vier do navegador some). Qualquer item ruim recusa o pedido todo.
 */
export function lerEntradasMinimas(v: unknown): EntradaMinimaDaLoja[] | null {
  if (!Array.isArray(v) || v.length === 0) return null
  const lidas = v.map((item): EntradaMinimaDaLoja | null => {
    if (typeof item !== 'object' || item === null) return null
    const { lojaId, pct } = item as Record<string, unknown>
    const pctLido = lerEntradaMinimaPct(pct)
    return typeof lojaId === 'string' && ehUuid(lojaId) && pctLido !== null ? { lojaId, pct: pctLido } : null
  })
  const todasLegiveis = lidas.every(l => l !== null)
  const semRepetida = new Set(lidas.map(l => l?.lojaId)).size === lidas.length
  return todasLegiveis && semRepetida ? (lidas as EntradaMinimaDaLoja[]) : null
}
