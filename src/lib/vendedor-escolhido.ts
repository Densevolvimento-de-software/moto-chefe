// Quem pode deixar a venda no nome de outra pessoa AO LANÇAR. Trocar o vendedor de venda já feita é outra
// regra, só dos sócios (podeTrocarVendedorVenda, valor-venda.ts). admin_rede entra como admin_socio na sessão
// (grupos-liberados.ts), então a lista cobre a persona também.
const PAPEIS_QUE_ESCOLHEM_VENDEDOR: readonly string[] = ['admin_geral', 'admin_socio', 'aux_adm']

export const podeEscolherVendedor = (papel: string): boolean => PAPEIS_QUE_ESCOLHEM_VENDEDOR.includes(papel)

/**
 * Em nome de quem a venda sai: o escolhido, se quem registra pode escolher; senão, quem registra.
 * O id escolhido ainda precisa ser conferido no servidor (vendedorDaConta, na moto; o grupo da loja, na peça).
 */
export const vendedorDaVenda = (usuario: { id: string; papel: string }, escolhido?: string | null): string =>
  podeEscolherVendedor(usuario.papel) && escolhido ? escolhido : usuario.id

export type ResponsavelOpcao = { id: string; nome: string; lojaNome: string | null }

/**
 * A lista do campo Responsável: as pessoas do grupo da loja da venda mais quem registra (que pode
 * deixar a venda no próprio nome mesmo sem ser do grupo), em ordem alfabética, cada uma com a sua loja.
 */
export function opcoesDeResponsavel(
  doGrupo: readonly { id: string; nome: string; lojaId: string | null }[],
  lojas: readonly { id: string; nome: string }[],
  logado: { id: string; nome: string; lojaId: string | null },
): ResponsavelOpcao[] {
  const pessoas = doGrupo.some(p => p.id === logado.id) ? doGrupo : [...doGrupo, logado]
  return pessoas
    .map(p => ({ id: p.id, nome: p.nome, lojaNome: lojas.find(l => l.id === p.lojaId)?.nome ?? null }))
    .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
}
