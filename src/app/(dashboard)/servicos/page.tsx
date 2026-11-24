import { getUsuarioLogado, isAdmin } from '@/lib/auth'
import { usuarioPodeAcessar } from '@/lib/navegacao-servidor'
import { redirect } from 'next/navigation'
import { db } from '@/lib/db'
import { servicosCatalogo } from '@/lib/db/schema'
import { asc } from 'drizzle-orm'
import { ServicosCatalogo } from './components/servicos-catalogo'

export default async function ServicosPage() {
  const usuario = await getUsuarioLogado()
  if (!usuarioPodeAcessar(usuario, '/servicos')) redirect('/dashboard')

  const servicos = await db.select().from(servicosCatalogo).orderBy(asc(servicosCatalogo.nome))

  return <ServicosCatalogo servicos={servicos} podeGerir={isAdmin(usuario.papel)} />
}
