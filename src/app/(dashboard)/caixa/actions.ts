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
import { getGrupoIdDaLoja } from '@/lib/grupo'
import { caminhoDoComprovanteCaixa, lojaEfetivaDoLancamento, recusaDoComprovante } from '@/lib/comprovante-caixa'

// Outra Conta, loja que ele não opera e id inexistente recebem a mesma frase (#153).
const NAO_ENCONTRADO = 'Lançamento não encontrado'

type LancamentoInput = {
  lojaId: string
  tipo: 'entrada' | 'saida'
  categoria: string
  descricao?: string
  valor: string
  data: string
}

// Recusa de categoria (#834) volta como { ok: false, erro }: lançada, a mensagem some no build de
// produção (#404). Os outros erros seguem lançados, como antes.
export async function criarLancamentoAction(dados: LancamentoInput, comprovante?: FormData) {
  return acao(() => criarLancamento(dados, comprovante?.get('file')))
}

// Tudo conferido antes de subir o arquivo; o caminho sai do grupo da loja, nunca do navegador (#153).
async function criarLancamento(dados: LancamentoInput, arquivo: FormDataEntryValue | null | undefined) {
  const usuario = await getUsuarioLogado()
  if (!['admin_geral', 'admin_socio', 'aux_adm'].includes(usuario.papel)) {
    throw new Error('Sem permissão')
  }

  const loja = lojaEfetivaDoLancamento(usuario, dados.lojaId)
  if ('erro' in loja) throw new Error(loja.erro)
  if (!(await podeAgirNaLoja(usuario, loja.lojaId))) throw new Error('Sem permissão para esta loja')
  await conferirCategoriaCaixaDaLoja(db, loja.lojaId, dados.categoria, dados.tipo)

  const valorNum = parseFloat(dados.valor)
  if (isNaN(valorNum) || valorNum <= 0) {
    throw new Error('Valor inválido')
  }

  const file = arquivo instanceof File ? arquivo : null
  if (dados.tipo === 'saida' && !file) {
    throw new Error('Comprovante obrigatório para saídas')
  }
  const recusa = file ? recusaDoComprovante(file) : null
  if (recusa) throw new Error(recusa)

  const comprovanteUrl = file
    ? caminhoDoComprovanteCaixa(await getGrupoIdDaLoja(loja.lojaId), file.type, `${Date.now()}-${crypto.randomUUID()}`)
    : null
  // Só com arquivo: lançamento sem comprovante não fala com o Storage.
  const storage = file ? clienteSupabaseAdmin().storage.from('comprovantes') : null
  if (storage && file && comprovanteUrl) {
    const { error } = await storage.upload(comprovanteUrl, file, { contentType: file.type })
    if (error) throw new Error(`Erro no upload: ${error.message}`)
  }

  try {
    await db.insert(lancamentosCaixa).values({
      lojaId: loja.lojaId,
      usuarioId: usuario.id,
      tipo: dados.tipo,
      categoria: dados.categoria,
      descricao: dados.descricao || null,
      valor: dados.valor,
      data: dados.data,
      // Lançamento à mão não se liga a venda: só o servidor faz esse vínculo (#153).
      comprovanteUrl,
    })
  } catch (e) {
    // Sem a linha, o arquivo ficaria órfão no bucket.
    if (storage && comprovanteUrl) await storage.remove([comprovanteUrl]).catch(() => {})
    throw e
  }

  revalidatePath('/caixa')
  revalidatePath('/financeiro')
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
