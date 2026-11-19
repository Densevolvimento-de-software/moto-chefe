// Token de integração colado pela tela (#126): espaço, tab e quebra de linha da cópia saem antes de qualquer uso.
// No meio de um header HTTP, o fetch lança TypeError com o valor inteiro (o token) na mensagem do erro.
export const normalizarToken = (colado: unknown) => (typeof colado === 'string' ? colado.replace(/\s+/g, '') : '')
