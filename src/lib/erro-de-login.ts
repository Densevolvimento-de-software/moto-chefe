// Frase da tela de login para o erro do Auth do Supabase (?error=... em /login).
// O login bloqueado no Auth (acesso desativado em /admin/acessos-fabrica) chega como erro do
// próprio login, antes de o app conferir o `ativo`: sem isto, a tela dizia "senha errada".
export type MotivoErroLogin = 'indisponivel' | 'inativo' | '1'

export function motivoDoErroDeLogin(erro: { name: string; status?: number; code?: string }): MotivoErroLogin {
  if (erro.name === 'AuthRetryableFetchError' || !erro.status) return 'indisponivel'
  // `user_banned`: ErrorCode do @supabase/auth-js.
  if (erro.code === 'user_banned') return 'inativo'
  return '1'
}
