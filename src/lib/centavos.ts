/** Arredonda um valor em reais para o centavo. */
export const centavos = (v: number) => Math.round(v * 100) / 100

/** Arredonda para cima ao centavo; o toFixed tira o resto de ponto flutuante (800,0000000001 fica 800). */
export const centavosParaCima = (v: number) => Math.ceil(Number((v * 100).toFixed(6))) / 100
