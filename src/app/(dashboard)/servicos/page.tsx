import { getUsuarioLogado } from '@/lib/auth'
import { usuarioPodeAcessar } from '@/lib/navegacao-servidor'
import { redirect } from 'next/navigation'
import { contaDoGrupoAtivo } from '@/lib/grupo'
import { listarServicosDaConta } from '@/lib/servicos-da-conta'
import { podeGerirServicos } from '@/lib/servico-regras'
import { ServicosCatalogo } from './components/servicos-catalogo'

export default async function ServicosPage() {
  const usuario = await getUsuarioLogado()
  if (!usuarioPodeAcessar(usuario, '/servicos')) redirect('/dashboard')

  const contaId = await contaDoGrupoAtivo(usuario)
  const servicos = await listarServicosDaConta(contaId)

  return <ServicosCatalogo servicos={servicos} podeGerir={podeGerirServicos(usuario)} />
}
