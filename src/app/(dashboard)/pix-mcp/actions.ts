'use server'

import { db } from '@/lib/db'
import { tipoCorrespondenciaPixEnum, vendas, ordensServico, pedidosVenda, vendasPecas } from '@/lib/db/schema'
import { eq, and, inArray } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { getUsuarioLogado } from '@/lib/auth'
import { getGrupoAtivo, listarLojaIdsDoGrupoAtivo } from '@/lib/grupo'
import { acao, RecusaUsuario } from '@/lib/resultado-action'
import { podeGerirConciliacao } from '@/lib/conciliacao-papeis'
import { COMPLETA_FORCADA, COMPLETA_FORCADA_PEDIR_A_GESTOR } from '@/lib/conciliacao-status'
import { desvincularPix, vincularPix, type VinculoPix } from '@/lib/pix-vinculo'

const PAPEIS_PERMITIDOS = ['admin_geral', 'admin_socio', 'aux_adm', 'vendedor']
type Tipo = typeof tipoCorrespondenciaPixEnum.enumValues[number]

// Recusa volta como valor: em produção a mensagem de erro lançado não chega à tela (#404).
export async function lancarCorrespondenciaAction(id: string, tipo: Tipo, numero: string) {
  return acao(() => lancarCorrespondencia(id, tipo, numero))
}
async function lancarCorrespondencia(id: string, tipo: Tipo, numero: string) {
  const usuario = await getUsuarioLogado()
  if (!PAPEIS_PERMITIDOS.includes(usuario.papel)) throw new RecusaUsuario('Sem permissão')
  // O tipo vem do navegador: fora do enum não pode cair num ramo por exclusão.
  if (!(tipoCorrespondenciaPixEnum.enumValues as readonly unknown[]).includes(tipo)) throw new RecusaUsuario('Tipo inválido')
  const grupo = await getGrupoAtivo(usuario)
  const lojaIdsGrupo = await listarLojaIdsDoGrupoAtivo(usuario)

  const vinculo = await vinculoPeloNumero(tipo, String(numero), lojaIdsGrupo, grupo.nome)
  await vincularPix(id, grupo.id, vinculo, usuario.id)

  revalidatePath('/pix-mcp')
}

// O número só é procurado nas lojas do grupo ativo: NF e OS se repetem entre Contas.
async function vinculoPeloNumero(tipo: Tipo, numero: string, lojaIdsGrupo: string[], nomeGrupo: string): Promise<VinculoPix> {
  if (tipo === 'venda') {
    const [venda] = await db.select({ id: vendas.id }).from(vendas)
      .where(and(eq(vendas.notaFiscalSaida, numero), inArray(vendas.lojaId, lojaIdsGrupo))).limit(1)
    if (!venda) throw new RecusaUsuario(`NF ${numero} não encontrada no grupo ${nomeGrupo}`)
    return { tipo, vendaId: venda.id }
  }

  const numeroInt = parseInt(numero, 10)
  if (!numeroInt || numeroInt <= 0) throw new RecusaUsuario('Número inválido')

  if (tipo === 'os') {
    const [os] = await db.select({ id: ordensServico.id }).from(ordensServico)
      .where(and(eq(ordensServico.numero, numeroInt), inArray(ordensServico.lojaId, lojaIdsGrupo))).limit(1)
    if (!os) throw new RecusaUsuario(`OS #${numeroInt} não encontrada no grupo ${nomeGrupo}`)
    return { tipo, osId: os.id }
  }
  if (tipo === 'pedido') {
    const [pedido] = await db.select({ id: pedidosVenda.id }).from(pedidosVenda)
      .where(and(eq(pedidosVenda.numero, numeroInt), inArray(pedidosVenda.lojaId, lojaIdsGrupo))).limit(1)
    if (!pedido) throw new RecusaUsuario(`Pedido #${numeroInt} não encontrado no grupo ${nomeGrupo}`)
    return { tipo, pedidoId: pedido.id }
  }
  const [peca] = await db.select({ id: vendasPecas.id }).from(vendasPecas)
    .where(and(eq(vendasPecas.numero, numeroInt), inArray(vendasPecas.lojaId, lojaIdsGrupo))).limit(1)
  if (!peca) throw new RecusaUsuario(`Venda PA #${numeroInt} não encontrada no grupo ${nomeGrupo}`)
  return { tipo, pecaVendaId: peca.id }
}

export async function removerCorrespondenciaAction(id: string) {
  return acao(() => removerCorrespondencia(id))
}
async function removerCorrespondencia(id: string) {
  const usuario = await getUsuarioLogado()
  if (!PAPEIS_PERMITIDOS.includes(usuario.papel)) throw new RecusaUsuario('Sem permissão')
  const grupo = await getGrupoAtivo(usuario)
  await desvincularPix(id, grupo.id, podeGerirConciliacao(usuario.papel) ? COMPLETA_FORCADA : COMPLETA_FORCADA_PEDIR_A_GESTOR)
  revalidatePath('/pix-mcp')
}
