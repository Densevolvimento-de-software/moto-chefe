// Token de integração colado pela tela (#126): espaço, tab e quebra de linha da cópia saem antes de qualquer uso.
// Token de API em header de autenticação é um bloco só, sem espaço (token68, RFC 7235).
export const normalizarToken = (colado: unknown) => (typeof colado === 'string' ? colado.replace(/\s+/g, '') : '')
