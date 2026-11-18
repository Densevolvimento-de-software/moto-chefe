/** Quem vê e pode usar o "Cancelar venda" (#191); a NF ainda pode recusar, ver travaDoPapel. */
export const PAPEIS_QUE_CANCELAM_VENDA: ReadonlySet<string> = new Set(['admin_geral', 'admin_socio', 'aux_adm'])

/** A recusa do "Cancelar venda" que depende do papel (#191), ou null se o papel não trava. */
export function travaDoPapel(papel: string, notaFiscalSaida: string | null): string | null {
  if (papel === 'aux_adm' && notaFiscalSaida) {
    return `Esta venda tem NF registrada (nº ${notaFiscalSaida}). Cancelar venda com nota fiscal fica com os administradores; fale com o Cesar.`
  }
  return null
}

/** A linha do diálogo quando o pedido tem várias motos (#23): cancelar uma venda dele cancela todas. */
export function avisoDoPedidoNoCancelar(numeroDoPedido: number | null, motos: number): string | null {
  if (motos < 2) return null
  const pedido = numeroDoPedido == null ? 'de um pedido' : `do pedido nº ${numeroDoPedido},`
  return `Esta venda é ${pedido} com ${motos} motos: as ${motos} vendas são canceladas juntas e as ${motos} motos voltam ao estoque.`
}
