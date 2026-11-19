'use server'
import { getUsuarioLogado } from '@/lib/auth'
import { podeAgirNaLoja } from '@/lib/acesso-registro'
import { db } from '@/lib/db'
import { lancamentosCaixa } from '@/lib/db/schema'
import { conferirCategoriaCaixaDaLoja } from '@/lib/categorias-do-grupo'
import { acao, RecusaUsuario } from '@/lib/resultado-action'
import { lancamentoCaixaDoUsuario } from '@/lib/lancamento-caixa-do-usuario'
import { eq, and } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { clienteSupabaseAdmin } from '@/lib/supabase/admin'

// Outra Conta, loja que ele não opera e id inexistente recebem a mesma frase (#153).
const NAO_ENCONTRADO = 'Lançamento não encontrado'

type LancamentoInput = {
  lojaId: string
  tipo: 'entrada' | 'saida'
  categoria: string
  descricao?: string
  valor: string
  data: string
  comprovanteUrl?: string
}

// Recusa de categoria (#834) volta como { ok: false, erro }: lançada, a mensagem some no build de
// produção (#404). Os outros erros seguem lançados, como antes.
export async function criarLancamentoAction(dados: LancamentoInput, comprovante?: FormData) {
  return acao(async () => {
    const comprovanteUrl = comprovante ? await uploadComprovanteAction(comprovante) : dados.comprovanteUrl
    return criarLancamento({ ...dados, comprovanteUrl })
  })
}

async function criarLancamento(dados: LancamentoInput) {
  const usuario = await getUsuarioLogado()
  if (!['admin_geral', 'admin_socio', 'aux_adm'].includes(usuario.papel)) {
    throw new Error('Sem permissão')
  }

  const isAdmin = ['admin_geral', 'admin_socio'].includes(usuario.papel)
  const lojaIdFinal = isAdmin ? dados.lojaId : usuario.lojaId
  if (!lojaIdFinal) throw new Error('Loja inválida')
  if (!isAdmin && dados.lojaId && dados.lojaId !== usuario.lojaId) {
    throw new Error('Sem permissão para esta loja')
  }
  if (!(await podeAgirNaLoja(usuario, lojaIdFinal))) throw new Error('Sem permissão para esta loja')
  await conferirCategoriaCaixaDaLoja(db, lojaIdFinal, dados.categoria, dados.tipo)

  const valorNum = parseFloat(dados.valor)
  if (isNaN(valorNum) || valorNum <= 0) {
    throw new Error('Valor inválido')
  }

  if (dados.tipo === 'saida' && !dados.comprovanteUrl) {
    throw new Error('Comprovante obrigatório para saídas')
  }

  await db.insert(lancamentosCaixa).values({
    lojaId: lojaIdFinal,
    usuarioId: usuario.id,
    tipo: dados.tipo,
    categoria: dados.categoria,
    descricao: dados.descricao || null,
    valor: dados.valor,
    data: dados.data,
    // Lançamento à mão não se liga a venda: só o servidor faz esse vínculo (#153).
    comprovanteUrl: dados.comprovanteUrl || null,
  })

  revalidatePath('/caixa')
  revalidatePath('/financeiro')
}

export async function uploadComprovanteAction(formData: FormData): Promise<string> {
  const usuario = await getUsuarioLogado()
  if (!['admin_geral', 'admin_socio', 'aux_adm'].includes(usuario.papel)) {
    throw new Error('Sem permissão')
  }

  const file = formData.get('file') as File
  if (!file || file.size === 0) throw new Error('Arquivo não enviado')

  const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
  if (!allowedTypes.includes(file.type)) {
    throw new Error('Formato não suportado. Envie JPG, PNG, WebP ou PDF.')
  }

  if (file.size > 10 * 1024 * 1024) {
    throw new Error('Arquivo muito grande. Máximo: 10MB.')
  }

  const extMap: Record<string, string> = {
    'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf',
  }
  const ext = extMap[file.type] ?? 'bin'
  const fileName = `${Date.now()}-${crypto.randomUUID()}.${ext}`
  const filePath = `caixa/${fileName}`

  const supabaseAdmin = clienteSupabaseAdmin()
  const { error } = await supabaseAdmin.storage
    .from('comprovantes')
    .upload(filePath, file, { contentType: file.type })

  if (error) throw new Error(`Erro no upload: ${error.message}`)

  return filePath
}

export async function getComprovanteUrlAction(filePath: string): Promise<string> {
  const usuario = await getUsuarioLogado()
  if (!['admin_geral', 'admin_socio', 'aux_adm'].includes(usuario.papel)) {
    throw new Error('Sem permissão')
  }

  // Rejeita caminhos suspeitos antes de qualquer chamada ao storage
  if (!filePath.startsWith('caixa/') || filePath.includes('..') || filePath.includes('\0')) {
    throw new Error('Caminho inválido')
  }

  // O caminho só abre se for o comprovante gravado num lançamento que ele pode ver (#153).
  if (!(await lancamentoCaixaDoUsuario(usuario, { comprovante: filePath }))) throw new RecusaUsuario('Comprovante não encontrado')

  const supabaseAdmin = clienteSupabaseAdmin()
  const { data, error } = await supabaseAdmin.storage
    .from('comprovantes')
    .createSignedUrl(filePath, 600)

  if (error || !data?.signedUrl) throw new Error('Erro ao gerar URL do comprovante')
  return data.signedUrl
}

export async function aprovarLancamentoAction(lancamentoId: string) {
  const usuario = await getUsuarioLogado()
  if (!['admin_geral', 'admin_socio'].includes(usuario.papel)) {
    throw new Error('Sem permissão')
  }

  const lancamento = await lancamentoCaixaDoUsuario(usuario, { id: lancamentoId })
  if (!lancamento) throw new RecusaUsuario(NAO_ENCONTRADO)
  if (lancamento.tipo !== 'saida') throw new RecusaUsuario('Apenas saídas podem ser aprovadas')
  if (lancamento.status === 'aprovado') throw new RecusaUsuario('Lançamento já aprovado')

  const gravados = await db
    .update(lancamentosCaixa)
    .set({ statusAprovacao: 'aprovado', aprovadoPorId: usuario.id, aprovadoEm: new Date() })
    .where(and(eq(lancamentosCaixa.id, lancamento.id), eq(lancamentosCaixa.lojaId, lancamento.lojaId)))
    .returning({ id: lancamentosCaixa.id })
  if (gravados.length === 0) throw new RecusaUsuario(NAO_ENCONTRADO)

  revalidatePath('/caixa')
}

export async function reprovarLancamentoAction(lancamentoId: string) {
  const usuario = await getUsuarioLogado()
  if (!['admin_geral', 'admin_socio'].includes(usuario.papel)) {
    throw new Error('Sem permissão')
  }

  const lancamento = await lancamentoCaixaDoUsuario(usuario, { id: lancamentoId })
  if (!lancamento) throw new RecusaUsuario(NAO_ENCONTRADO)
  if (lancamento.tipo !== 'saida') throw new RecusaUsuario('Apenas saídas podem ser reprovadas')
  if (lancamento.status === 'reprovado') throw new RecusaUsuario('Lançamento já reprovado')

  const gravados = await db
    .update(lancamentosCaixa)
    .set({ statusAprovacao: 'reprovado', aprovadoPorId: usuario.id, aprovadoEm: new Date() })
    .where(and(eq(lancamentosCaixa.id, lancamento.id), eq(lancamentosCaixa.lojaId, lancamento.lojaId)))
    .returning({ id: lancamentosCaixa.id })
  if (gravados.length === 0) throw new RecusaUsuario(NAO_ENCONTRADO)

  revalidatePath('/caixa')
}

export async function excluirLancamentoAction(lancamentoId: string) {
  const usuario = await getUsuarioLogado()
  if (!['admin_geral', 'admin_socio'].includes(usuario.papel)) {
    throw new Error('Sem permissão')
  }

  const lancamento = await lancamentoCaixaDoUsuario(usuario, { id: lancamentoId })
  if (!lancamento) throw new RecusaUsuario(NAO_ENCONTRADO)

  const apagados = await db.delete(lancamentosCaixa)
    .where(and(eq(lancamentosCaixa.id, lancamento.id), eq(lancamentosCaixa.lojaId, lancamento.lojaId)))
    .returning({ id: lancamentosCaixa.id })
  if (apagados.length === 0) throw new RecusaUsuario(NAO_ENCONTRADO)

  revalidatePath('/caixa')
  revalidatePath('/financeiro')
}
