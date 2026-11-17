// Tamanho mínimo de senha do MOVA: a troca da própria senha e a senha que o admin_geral
// define para o login da fábrica usam o mesmo número.
export const SENHA_MINIMA = 8

export const FRASE_SENHA_CURTA = `A senha deve ter pelo menos ${SENHA_MINIMA} caracteres.`

export function senhaCurta(senha: string): boolean {
  return senha.length < SENHA_MINIMA
}
