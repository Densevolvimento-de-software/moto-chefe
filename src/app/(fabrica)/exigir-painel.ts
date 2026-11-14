// Guarda da área /fabrica (layout, painel e impresso): a mesma regra do menu, antes de buscar dados.
import { redirect } from 'next/navigation'
import { getUsuarioLogado } from '@/lib/auth'
import { usuarioPodeAcessar } from '@/lib/navegacao-servidor'
import { destinoSemPainel } from '@/lib/login-fabrica'
import { ROTA_PAINEL_FABRICA } from '@/lib/painel-fabrica'

export async function exigirPainelFabrica() {
  const usuario = await getUsuarioLogado()
  if (!usuarioPodeAcessar(usuario, ROTA_PAINEL_FABRICA)) redirect(destinoSemPainel(usuario.papel))
  return usuario
}
