'use server'
import { getUsuarioLogado } from '@/lib/auth'
import { contaDoGrupoAtivo } from '@/lib/grupo'
import { listarServicosDaConta, podeGerirServicos } from '@/lib/servicos-da-conta'
import { db } from '@/lib/db'
import { servicosCatalogo } from '@/lib/db/schema'
import { and, eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'

const GESTORES = ['admin_geral', 'admin_socio', 'aux_adm'] as const

async function verificarAcesso() {
  const usuario = await getUsuarioLogado()
  if (!(GESTORES as readonly string[]).includes(usuario.papel)) {
    throw new Error('Sem permissão')
  }
  return usuario
}

async function verificarGestao() {
  const usuario = await getUsuarioLogado()
  if (!podeGerirServicos(usuario)) throw new Error('Sem permissão')
  return contaDoGrupoAtivo(usuario)
}

export type ServicoInput = {
  nome: string
  tempoPrevistoMinutos?: number | null
  valor: number
}

export async function listarServicosAction(params?: { apenasAtivos?: boolean }) {
  const usuario = await verificarAcesso()
  const contaId = await contaDoGrupoAtivo(usuario)
  const todos = await listarServicosDaConta(contaId)
  return params?.apenasAtivos ? todos.filter(s => s.ativo) : todos
}

export async function criarServicoAction(input: ServicoInput) {
  const contaId = await verificarGestao()
  const nome = input.nome.trim()
  if (!nome) throw new Error('Nome é obrigatório')
  if (input.valor < 0) throw new Error('Valor não pode ser negativo')

  const [novo] = await db.insert(servicosCatalogo).values({
    contaId,
    nome,
    tempoPrevistoMinutos: input.tempoPrevistoMinutos || null,
    valor: String(input.valor),
  }).returning({ id: servicosCatalogo.id })

  revalidatePath('/servicos')
  return novo
}

export async function atualizarServicoAction(id: string, input: ServicoInput) {
  const contaId = await verificarGestao()
  const nome = input.nome.trim()
  if (!nome) throw new Error('Nome é obrigatório')
  if (input.valor < 0) throw new Error('Valor não pode ser negativo')

  const alterados = await db.update(servicosCatalogo).set({
    nome,
    tempoPrevistoMinutos: input.tempoPrevistoMinutos || null,
    valor: String(input.valor),
    atualizadoEm: new Date(),
  }).where(and(eq(servicosCatalogo.id, id), eq(servicosCatalogo.contaId, contaId))).returning({ id: servicosCatalogo.id })
  if (!alterados.length) throw new Error('Serviço não encontrado')

  revalidatePath('/servicos')
}

export async function inativarServicoAction(id: string) {
  const contaId = await verificarGestao()
  const alterados = await db.update(servicosCatalogo)
    .set({ ativo: false, atualizadoEm: new Date() })
    .where(and(eq(servicosCatalogo.id, id), eq(servicosCatalogo.contaId, contaId))).returning({ id: servicosCatalogo.id })
  if (!alterados.length) throw new Error('Serviço não encontrado')
  revalidatePath('/servicos')
}

export async function reativarServicoAction(id: string) {
  const contaId = await verificarGestao()
  const alterados = await db.update(servicosCatalogo)
    .set({ ativo: true, atualizadoEm: new Date() })
    .where(and(eq(servicosCatalogo.id, id), eq(servicosCatalogo.contaId, contaId))).returning({ id: servicosCatalogo.id })
  if (!alterados.length) throw new Error('Serviço não encontrado')
  revalidatePath('/servicos')
}
