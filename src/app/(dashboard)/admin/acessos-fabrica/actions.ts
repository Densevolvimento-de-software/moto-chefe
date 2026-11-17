'use server'
// Logins da fábrica MotoChefe (papel `fabrica`, #3): só o admin_geral cria, desativa/reativa e
// troca a senha. O papel vai também no app_metadata do Auth (só a chave de serviço grava), que é
// o que o middleware lê para prender o login em /fabrica. Linha e Auth andam juntos.
import { revalidatePath } from 'next/cache'
import { and, eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { usuarios } from '@/lib/db/schema'
import { exigirAdminGeral } from '@/lib/admin-geral'
import { acao, RecusaUsuario, type ResultadoAction } from '@/lib/resultado-action'
import { registrarAcaoSensivelSemFalhar } from '@/lib/log-acoes'
import { ROTA_ACESSOS_FABRICA, validarAcessoFabrica } from '@/lib/acessos-fabrica'
import { FRASE_SENHA_CURTA, senhaCurta } from '@/lib/senha'
import { PAPEL_FABRICA } from '@/lib/login-fabrica'
import { ehUuid } from '@/lib/uuid'
import { clienteSupabaseAdmin } from '@/lib/supabase/admin'
import { LOGIN_NAO_CRIADO, criarLoginComCadastro } from '@/lib/supabase/criar-login'
import { bloquearLogin } from '@/lib/supabase/bloqueio-login'

// Mesma frase para id de outro papel, de outra Conta e inexistente: não revela o que existe.
const NAO_ENCONTRADO = 'Acesso não encontrado'
const AUTH_FORA = 'Não foi possível mudar o acesso agora. Tente de novo.'

/** O registro pelo id, só se for login da fábrica. */
async function acessoDaFabrica(id: string) {
  if (!ehUuid(id)) throw new RecusaUsuario(NAO_ENCONTRADO)
  const [a] = await db.select({ id: usuarios.id, nome: usuarios.nome }).from(usuarios)
    .where(and(eq(usuarios.id, id), eq(usuarios.papel, PAPEL_FABRICA))).limit(1)
  if (!a) throw new RecusaUsuario(NAO_ENCONTRADO)
  return a
}

const registrar = (adminId: string, alvo: { id: string; nome: string }, acaoFeita: string) =>
  registrarAcaoSensivelSemFalhar({
    tipo: 'permissao_alterada', usuarioId: adminId, contaId: null,
    detalhe: { alvoId: alvo.id, alvoNome: alvo.nome, papel: PAPEL_FABRICA, acao: acaoFeita },
  })

export async function criarAcessoFabricaAction(entrada: unknown): Promise<ResultadoAction<{ id: string }>> {
  return acao(async () => {
    const admin = await exigirAdminGeral()
    const v = validarAcessoFabrica(entrada)
    if (!v.ok) throw new RecusaUsuario(v.erro)
    const { nome, email, senha } = v.dados
    // Sem senha provisória: a fábrica não troca a própria senha (quem troca é o admin_geral).
    const id = await criarLoginComCadastro(clienteSupabaseAdmin().auth.admin, { email, senha, appMetadata: { papel: PAPEL_FABRICA } },
      // Campo a campo; sem loja, Conta nem extras (a 0192 recusa no banco).
      async (novoId) => { await db.insert(usuarios).values({ id: novoId, nome, email, papel: PAPEL_FABRICA }) })
    if (!id) throw new RecusaUsuario(LOGIN_NAO_CRIADO)
    await registrar(admin.id, { id, nome }, 'criado')
    revalidatePath(ROTA_ACESSOS_FABRICA)
    return { id }
  })
}

export async function alternarAcessoFabricaAction(id: string, ativo: boolean): Promise<ResultadoAction> {
  return acao(async () => {
    const admin = await exigirAdminGeral()
    const alvo = await acessoDaFabrica(id)
    // Cadastro e Auth juntos: se o Auth recusar, a transação desfaz o `ativo`.
    await db.transaction(async tx => {
      const mudou = await tx.update(usuarios).set({ ativo: ativo === true })
        .where(and(eq(usuarios.id, alvo.id), eq(usuarios.papel, PAPEL_FABRICA))).returning({ id: usuarios.id })
      if (mudou.length === 0) throw new RecusaUsuario(NAO_ENCONTRADO)
      if (!(await bloquearLogin(clienteSupabaseAdmin().auth.admin, alvo.id, ativo !== true))) throw new RecusaUsuario(AUTH_FORA)
    })
    await registrar(admin.id, alvo, ativo === true ? 'ativado' : 'desativado')
    revalidatePath(ROTA_ACESSOS_FABRICA)
  })
}

export async function redefinirSenhaFabricaAction(id: string, senha: string): Promise<ResultadoAction> {
  return acao(async () => {
    const admin = await exigirAdminGeral()
    if (typeof senha !== 'string' || senhaCurta(senha)) throw new RecusaUsuario(FRASE_SENHA_CURTA)
    const alvo = await acessoDaFabrica(id)
    const { error } = await clienteSupabaseAdmin().auth.admin.updateUserById(alvo.id, { password: senha })
    if (error) throw new RecusaUsuario('Não foi possível trocar a senha agora. Tente de novo.')
    await registrar(admin.id, alvo, 'senha_redefinida')
  })
}
