// Página e cursor da API de leitura (#315, ADR-0021). Puro: sem banco e sem relógio. Cada conjunto diz a ordem
// do próprio cursor; aqui fica só o que é igual para todos.

export const TAMANHO_DA_PAGINA = 500

const BASE64URL = /^[A-Za-z0-9_-]+$/

/** Cursor é base64url de um objeto JSON. Só leva a ordem da página: a Conta e o período filtram na consulta. */
export function codificarCursorObjeto(valor: Record<string, string | number>): string {
  return Buffer.from(JSON.stringify(valor)).toString('base64url')
}

/** O objeto do cursor, ou nulo se não é base64url de um objeto JSON. Quem chama confere as chaves e os valores. */
export function decodificarCursorObjeto(texto: string): Record<string, unknown> | null {
  if (!BASE64URL.test(texto)) return null
  let valor: unknown
  try {
    valor = JSON.parse(Buffer.from(texto, 'base64url').toString('utf8'))
  } catch {
    return null
  }
  if (typeof valor !== 'object' || valor === null || Array.isArray(valor)) return null
  return valor as Record<string, unknown>
}

/** Corta a página: a consulta traz uma linha a mais, e ela só serve para dizer que há próxima página. */
export function cortarPagina<T>(linhas: T[]): { linhas: T[]; temMais: boolean } {
  return { linhas: linhas.slice(0, TAMANHO_DA_PAGINA), temMais: linhas.length > TAMANHO_DA_PAGINA }
}
