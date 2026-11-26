'use server'
import { getUsuarioLogado } from '@/lib/auth'
import { contaDoGrupoAtivo } from '@/lib/grupo'
import { acessaModulo } from '@/lib/navegacao'
import { listarServicosDaConta } from '@/lib/servicos-da-conta'
import { podeGerirServicos, recusaDoServico } from '@/lib/servico-regras'
import { acao, RecusaUsuario } from '@/lib/resultado-action'
import { db } from '@/lib/db'
import { servicosCatalogo } from '@/lib/db/schema'
import { and, eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'

async function verificarAcesso() {
  const usuario = await getUsuarioLogado()
  // Mesma regra do menu e da página (navegacao.ts): quem pode abrir /servicos pode listar.
  if (!acessaModulo(usuario, 'servicos')) throw new RecusaUsuario('Sem permissão')
  return usuario
}

async function verificarGestao() {
  const usuario = await getUsuarioLogado()
  if (!podeGerirServicos(usuario)) throw new RecusaUsuario('Sem permissão')
  return contaDoGrupoAtivo(usuario)
}

export type ServicoInput = {
  nome: string
  tempoPrevistoMinutos?: number | null
  valor: number
}

// Só os campos do formulário entram: Conta, id e estado vêm do servidor, nunca do pedido.
function camposDoFormulario(input: ServicoInput) {
  const recusa = recusaDoServico(input)
  if (recusa) throw new RecusaUsuario(recusa)
  return {
    nome: input.nome.trim(),
    tempoPrevistoMinutos: input.tempoPrevistoMinutos || null,
    valor: String(input.valor),
  }
}

// Outra Conta e id inexistente recebem a mesma frase: ela não revela que o serviço existe em outra Conta.
async function alterarDaConta(contaId: string, id: string, campos: Partial<Pick<typeof servicosCatalogo.$inferInsert, 'nome' | 'tempoPrevistoMinutos' | 'valor' | 'ativo'>>) {
  const alterados = await db.update(servicosCatalogo)
    .set({ ...campos, atualizadoEm: new Date() })
    .where(and(eq(servicosCatalogo.id, id), eq(servicosCatalogo.contaId, contaId)))
    .returning({ id: servicosCatalogo.id })
  if (!alterados.length) throw new RecusaUsuario('Serviço não encontrado')
  revalidatePath('/servicos')
}

export async function listarServicosAction(...a: Parameters<typeof listarServicos>) {
  return acao(() => listarServicos(...a))
}
async function listarServicos(params?: { apenasAtivos?: boolean }) {
  const usuario = await verificarAcesso()
  const todos = await listarServicosDaConta(await contaDoGrupoAtivo(usuario))
  return params?.apenasAtivos ? todos.filter(s => s.ativo) : todos
}

export async function criarServicoAction(...a: Parameters<typeof criarServico>) {
  return acao(() => criarServico(...a))
}
async function criarServico(input: ServicoInput) {
  const contaId = await verificarGestao()
  const [novo] = await db.insert(servicosCatalogo).values({ contaId, ...camposDoFormulario(input) })
    .returning({ id: servicosCatalogo.id })
  revalidatePath('/servicos')
  return novo
}

export async function atualizarServicoAction(...a: Parameters<typeof atualizarServico>) {
  return acao(() => atualizarServico(...a))
}
async function atualizarServico(id: string, input: ServicoInput) {
  const contaId = await verificarGestao()
  await alterarDaConta(contaId, id, camposDoFormulario(input))
}

export async function inativarServicoAction(...a: Parameters<typeof inativarServico>) {
  return acao(() => inativarServico(...a))
}
async function inativarServico(id: string) {
  await alterarDaConta(await verificarGestao(), id, { ativo: false })
}

export async function reativarServicoAction(...a: Parameters<typeof reativarServico>) {
  return acao(() => reativarServico(...a))
}
async function reativarServico(id: string) {
  await alterarDaConta(await verificarGestao(), id, { ativo: true })
}
