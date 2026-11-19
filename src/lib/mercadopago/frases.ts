// Frases da credencial do Mercado Pago (#51). Módulo sem banco nem rede: o diálogo de grupo (cliente) reconhece
// por elas a recusa do Mercado Pago e a mostra embaixo do campo dele.
// O titular pode ter CNPJ ou CPF: a frase diz só que o documento não é o CNPJ do grupo.
const TITULAR_DE_OUTRO_DOCUMENTO = 'o titular da conta do Mercado Pago não tem o CNPJ deste grupo.'

export const FRASES_MP = {
  formato: 'Esse token não está no formato do Mercado Pago. Copie de novo o Access Token inteiro.',
  recusado: 'O Mercado Pago recusou esse token. Confira se é o Access Token de produção da conta da loja.',
  indisponivel: 'O Mercado Pago não respondeu agora. Tente de novo em alguns minutos.',
  teste: 'Esta credencial é de uma conta de teste do Mercado Pago. Aqui só entra a credencial da conta real da loja.',
  mensalidade: 'Esse token é da conta do MOVA que cobra a mensalidade. Use o token da conta da loja.',
  jaLigada: 'Essa conta do Mercado Pago já está ligada a outro grupo.',
  outroCnpj: `Credencial salva, mas confira: ${TITULAR_DE_OUTRO_DOCUMENTO}`,
} as const

// Tudo menos o aviso (outroCnpj), que acompanha a credencial gravada.
const RECUSAS_MP: readonly string[] = Object.entries(FRASES_MP).filter(([chave]) => chave !== 'outroCnpj').map(([, frase]) => frase)
export const ehRecusaDoMp = (erro: string) => RECUSAS_MP.includes(erro)

/** Aviso guardado no Editar Grupo (decisão do Luis, #51): fica à vista enquanto o titular for de outro CNPJ. */
export const AVISO_OUTRO_CNPJ = `Confira: ${TITULAR_DE_OUTRO_DOCUMENTO}`
