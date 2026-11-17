// Lista de /admin/acessos-fabrica: só os logins da fábrica (papel `fabrica`), nenhum usuário de Conta.
import { asc, eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { usuarios } from '@/lib/db/schema'
import { PAPEL_FABRICA } from '@/lib/login-fabrica'

export async function listarAcessosFabrica() {
  return db.select({ id: usuarios.id, nome: usuarios.nome, email: usuarios.email, ativo: usuarios.ativo })
    .from(usuarios).where(eq(usuarios.papel, PAPEL_FABRICA)).orderBy(asc(usuarios.nome))
}
