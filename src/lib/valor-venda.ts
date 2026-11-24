/**
 * Travas do "Editar venda" que só os sócios passam. O aux_adm edita os pagamentos e os dados do
 * comprador, nunca o valor (#293) nem o vendedor que recebe o crédito da venda.
 */
const PAPEIS_SOCIOS: ReadonlySet<string> = new Set(['admin_geral', 'admin_socio'])

export function podeAlterarValorVenda(papel: string): boolean {
  return PAPEIS_SOCIOS.has(papel)
}

/** A recusa da edição por mudança de valor (#293), ou null se o papel pode ou o valor não mudou. */
export function travaDoValorVenda(papel: string, valorGravado: number, valorEnviado: number): string | null {
  if (podeAlterarValorVenda(papel) || Math.abs(valorGravado - valorEnviado) < 0.005) return null
  return 'O valor da venda só pode ser alterado pelos administradores.'
}

/**
 * Quem pode trocar o vendedor de uma venda já feita. O vendedor decide a comissão, por isso só os
 * sócios trocam; quem opera a loja escolhe o vendedor só ao lançar a venda.
 */
export function podeTrocarVendedorVenda(papel: string): boolean {
  return PAPEIS_SOCIOS.has(papel)
}

/** A recusa da edição por troca de vendedor, ou null se o papel pode ou o vendedor não mudou. */
export function travaDoVendedorVenda(papel: string, vendedorGravado: string, vendedorEnviado: string | undefined): string | null {
  if (podeTrocarVendedorVenda(papel) || !vendedorEnviado || vendedorEnviado === vendedorGravado) return null
  return 'O vendedor da venda só pode ser trocado pelos sócios.'
}
