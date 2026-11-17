// Login novo: cria no Auth e grava o cadastro em `usuarios`. Se a gravação falha, o login sai
// do Auth, senão ficaria um login que entra sem cadastro. Usado por /admin/usuarios e pela tela
// de acessos da fábrica.
import type { clienteSupabaseAdmin } from '@/lib/supabase/admin'

type AuthAdmin = Pick<ReturnType<typeof clienteSupabaseAdmin>['auth']['admin'], 'createUser' | 'deleteUser'>

/** Frase de quando o Auth recusa (e-mail já usado em qualquer Conta, ou inválido): neutra. */
export const LOGIN_NAO_CRIADO = 'Não foi possível criar o login com este e-mail. Confira o endereço ou use outro.'

export type LoginNovo = {
  email: string
  senha: string
  /** Só a chave de serviço grava; o middleware lê o papel daqui (login da fábrica). */
  appMetadata?: Record<string, unknown>
  userMetadata?: Record<string, unknown>
}

/** `null` quando o Auth recusa (quem chama mostra LOGIN_NAO_CRIADO); erro da gravação segue lançado. */
export async function criarLoginComCadastro(auth: AuthAdmin, login: LoginNovo, gravar: (id: string) => Promise<void>): Promise<string | null> {
  const { data, error } = await auth.createUser({
    email: login.email,
    password: login.senha,
    email_confirm: true,
    ...(login.appMetadata ? { app_metadata: login.appMetadata } : {}),
    ...(login.userMetadata ? { user_metadata: login.userMetadata } : {}),
  })
  if (error || !data.user) return null
  try {
    await gravar(data.user.id)
  } catch (e) {
    // O Auth devolve o erro (não lança). Sem desfazer, sobra um login sem cadastro e o e-mail
    // fica ocupado: deixa rastro no log do servidor, só com o id.
    const desfeito = await auth.deleteUser(data.user.id).catch((falha: unknown) => ({ error: falha }))
    if (desfeito.error) console.error(`[criar-login] login ${data.user.id} criado no Auth e não desfeito depois da falha no cadastro`)
    throw e
  }
  return data.user.id
}
