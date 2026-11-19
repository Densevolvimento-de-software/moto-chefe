// Frases da credencial do Mercado Pago (#51). Módulo sem banco nem rede: o diálogo de grupo (cliente) reconhece
// por elas a recusa do Mercado Pago e a mostra embaixo do campo dele.
export const FRASES_MP = {
  formato: 'Esse token não está no formato do Mercado Pago. Copie de novo, sem espaços nem quebra de linha.',
  recusado: 'O Mercado Pago recusou esse token. Confira se é o Access Token de produção da conta da loja.',
  indisponivel: 'O Mercado Pago não respondeu agora. Tente de novo em alguns minutos.',
  teste: 'Esta credencial é de uma conta de teste do Mercado Pago. Aqui só entra a credencial da conta real da loja.',
  mensalidade: 'Esse token é da conta do MOVA que cobra a mensalidade. Use o token da conta da loja.',
  jaLigada: 'Essa conta do Mercado Pago já está ligada a outro grupo.',
  outroCnpj: 'Credencial salva, mas confira: a conta do Mercado Pago está em outro CNPJ, não no deste grupo.',
} as const

const RECUSAS_MP: readonly string[] = [
  FRASES_MP.formato, FRASES_MP.recusado, FRASES_MP.indisponivel, FRASES_MP.teste, FRASES_MP.mensalidade, FRASES_MP.jaLigada,
]
export const ehRecusaDoMp = (erro: string) => RECUSAS_MP.includes(erro)
