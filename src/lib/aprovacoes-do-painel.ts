import { listarLojaIdsDoGrupoAtivo, podeAprovarPagamentoSensivelNoGrupoAtivo, podeAprovarVendaBaixoValor } from '@/lib/grupo'
import { listarAprovacoesPendentes } from '@/lib/queries/motos'
import { papelAprova } from '@/lib/aprovacao-permissao'

type Usuario = Parameters<typeof podeAprovarPagamentoSensivelNoGrupoAtivo>[0] & Parameters<typeof listarLojaIdsDoGrupoAtivo>[0]

/**
 * Painel de aprovações em /vendas (#25, ponto 3 do Luis): as pendentes das lojas do grupo ativo para quem aprova (papelAprova, a
 * regra do servidor; o admin_rede chega aqui como admin_socio pelo usuarioDaRede, inclusive no grupo liberado que estiver ativo) e
 * para quem pode aprovar nele por liberação nominal. Os demais não recebem nada. Só as lojas do grupo ativo: outra Conta nunca entra.
 */
export async function aprovacoesDoPainel(usuario: Usuario) {
  const lojaIds = await listarLojaIdsDoGrupoAtivo(usuario)
  // As lojas são todas de um grupo só: uma checagem com qualquer delas vale para todas.
  const [podeAprovarValorMinimo, podeAprovarSensivel] = await Promise.all([
    lojaIds.length > 0 ? podeAprovarVendaBaixoValor(usuario, lojaIds[0]) : false,
    podeAprovarPagamentoSensivelNoGrupoAtivo(usuario),
  ])
  const vePainel = papelAprova(usuario.papel) || podeAprovarValorMinimo || podeAprovarSensivel
  return { aprovacoes: vePainel ? await listarAprovacoesPendentes(lojaIds) : [], podeAprovarValorMinimo, podeAprovarSensivel }
}
