/** minúsculas, sem acento, espaços colapsados — base do roteamento. */
export function normalizar(s: string): string {
  return (s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Número de nota como a SEFAZ compara: "0974" e "974" são o mesmo; só zeros vira "0".
 * O SQL pré-filtra com `ltrim(coluna, '0')` (que difere só em "000" e em espaços);
 * a comparação final de número ou série em JS passa sempre por aqui (#597).
 */
export function semZerosAEsquerda(texto: string | null | undefined): string {
  const aparado = (texto ?? '').trim()
  if (!aparado) return ''
  return aparado.replace(/^0+/, '') || '0'
}

/** Quantidade com a palavra certa: "1 moto", "2 motos", "0 motos". */
/** A palavra no singular com 1, no plural com outro número (sem o número). */
export const palavraPara = (n: number, um: string, varios: string) => (n === 1 ? um : varios)
export const plural = (n: number, um: string, varios: string) => `${n} ${palavraPara(n, um, varios)}`

/** "março de 2026" → "Março de 2026". */
export const comMaiuscula = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/** "Ana Paula Souza" → "AS": primeira letra do primeiro e do último nome, para o selo de iniciais. */
export function iniciaisDoNome(nome: string): string {
  const partes = nome.trim().split(/\s+/)
  return ((partes[0]?.[0] ?? '') + (partes.length > 1 ? partes[partes.length - 1][0] : '')).toUpperCase()
}
