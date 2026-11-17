// Bloqueio do login no Auth do Supabase: desativar só no MOVA (`usuarios.ativo`) deixa o login
// valendo no Auth (renovar a sessão, entrar direto). `ban_duration` é da API admin do Auth
// (@supabase/auth-js, AdminUserAttributes): duração com unidade, ou 'none' para tirar.
import type { clienteSupabaseAdmin } from '@/lib/supabase/admin'

type AuthAdmin = Pick<ReturnType<typeof clienteSupabaseAdmin>['auth']['admin'], 'updateUserById'>

/** ~100 anos: sem prazo de volta; reativar tira o bloqueio. */
const BLOQUEIO_SEM_PRAZO = '876000h'

/** `false` quando o Auth recusa (quem chama não muda o cadastro). */
export async function bloquearLogin(auth: AuthAdmin, id: string, bloqueado: boolean): Promise<boolean> {
  const { error } = await auth.updateUserById(id, { ban_duration: bloqueado ? BLOQUEIO_SEM_PRAZO : 'none' })
  return !error
}
