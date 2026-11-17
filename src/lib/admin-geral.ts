// Guarda das actions que só o admin_geral usa (telas soAdminGeral). Papel principal: papel
// extra não abre, como no menu. A recusa volta como { ok: false, erro } pela `acao`.
// As cópias antigas desta checagem (frases e retornos diferentes) trocam por esta na issue #5.
import { getUsuarioLogado, isAdmin } from '@/lib/auth'
import { RecusaUsuario } from '@/lib/resultado-action'

export async function exigirAdminGeral() {
  const usuario = await getUsuarioLogado()
  if (!isAdmin(usuario.papel)) throw new RecusaUsuario('Sem permissão')
  return usuario
}
