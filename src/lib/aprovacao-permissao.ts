// ─── Regras puras de quem aprova venda ────────────────────────────────────────
// A resolução dos grupos (qual grupo é a loja da venda, qual é a loja do
// aprovador) exige banco e fica em @/lib/grupo. Aqui mora só a REGRA, sem banco
// nem next/headers, para poder ser testada isoladamente.

// Quem aprova o quê vem do cadastro em /admin/usuarios (grupos_aprovacao e
// aprova_pagamento_sensivel), nunca de e-mail no código (#149).

// Só admin aprova. Os campos de aprovação existem no cadastro de qualquer
// usuário, mas não valem nada para vendedor/mecânico/aux_adm.
const PAPEIS_APROVADORES = ['admin_geral', 'admin_socio']

export function papelAprova(papel: string): boolean {
  return PAPEIS_APROVADORES.includes(papel)
}

export type UsuarioAprovador = {
  papel: string
  lojaId: string | null
  gruposAprovacao?: string[] | null
  aprovaPagamentoSensivel?: boolean | null
}

// admin_socio comum aprova no próprio grupo — o da loja fixa dele
// (usuarios.lojaId), nunca o do cookie grupoAtivo: a permissão de aprovar não
// deve depender de qual grupo ele está "olhando" no momento.
export function socioAprovaNoGrupo(
  usuario: { papel: string; lojaId: string | null },
  grupoVenda: string,
  grupoLojaDoSocio: string,
): boolean {
  if (usuario.papel !== 'admin_socio' || !usuario.lojaId) return false
  return grupoVenda === grupoLojaDoSocio
}

// Grupos liberados no cadastro, ALÉM do grupo da loja fixa. É por aqui que um
// sócio de um grupo aprova no outro sem precisar de deploy.
export function aprovaEmGrupoExtra(usuario: UsuarioAprovador, grupoAlvo: string): boolean {
  if (!papelAprova(usuario.papel)) return false
  return (usuario.gruposAprovacao ?? []).includes(grupoAlvo)
}

// Financiamento/transferência: só com a liberação explícita (aprova_pagamento_sensivel).
// admin_geral liberado aprova em todos os grupos (decisão do Luis, #149); os demais, no
// mesmo escopo do baixo valor: grupo da própria loja + grupos extras.
export function aprovaPagamentoSensivelNoGrupo(
  usuario: UsuarioAprovador,
  grupoAlvo: string,
  grupoDaLojaDoUsuario: string | null,
): boolean {
  if (!usuario.aprovaPagamentoSensivel) return false
  if (usuario.papel === 'admin_geral') return true
  if (!papelAprova(usuario.papel)) return false
  if (grupoDaLojaDoUsuario && grupoAlvo === grupoDaLojaDoUsuario) return true
  return (usuario.gruposAprovacao ?? []).includes(grupoAlvo)
}
