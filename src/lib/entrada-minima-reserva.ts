import { centavos } from './centavos'
import { fmtBRL } from './preco-minimo'

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
