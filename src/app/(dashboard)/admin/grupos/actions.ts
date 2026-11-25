'use server'
import { contasParaNovoGrupo, criarGrupo } from '@/lib/grupo-novo'
import { db } from '@/lib/db'
import { contas, grupos, mercadopagoConfig } from '@/lib/db/schema'
import { asc, eq, isNull, sql } from 'drizzle-orm'
import { moverGrupo, previaMoverGrupo } from '@/lib/mover-grupo'
import { origemDaRequisicaoAtual } from '@/lib/log-acoes'
import { getUsuarioLogado } from '@/lib/auth'
import { revalidatePath } from 'next/cache'
import { cifrar, decifrar } from '@/lib/cripto'
import { credencialMcpDoGrupoPorId, resumirEndpoint } from '@/lib/mcpai-credencial'
import { rotulosDasContasDaChave } from '@/lib/mcpai'
import { idsContasPixDoPedido } from '@/lib/pix-contas-liberadas'
import { FALHA_AO_ROTULAR, type RotuloConta } from '@/lib/rotulos-contas-mcp'
import { alterarTransferenciaEntreGrupos } from '@/lib/transferencia-grupos'
import { count } from 'drizzle-orm'
import { acao, RecusaUsuario, type ResultadoAction } from '@/lib/resultado-action'
import { ehUuid } from '@/lib/uuid'
import {
  aplicarCredencialMp, conferirCredencialMp, credencialMpParaTela, DEPENDENCIAS_CREDENCIAL_MP,
} from '@/lib/mercadopago/credencial'

// RecusaUsuario: nas actions que devolvem ResultadoAction, a frase chega à tela também em produção (#404).
async function assertAdmin() {
  const u = await getUsuarioLogado()
  if (u.papel !== 'admin_geral') throw new RecusaUsuario('Acesso restrito ao Admin Geral')
  return u
}

/**
 * O valor cifrado da chave do mcp.ai NÃO sai daqui: esta lista alimenta um
 * componente de cliente (o dialog), ou seja, tudo o que ela devolve é
 * serializado para o navegador. Em lugar do valor vai um resumo — host e os
 * últimos caracteres — que é o bastante para a pessoa reconhecer qual chave
 * está salva sem que a credencial trafegue.
 */
export async function listarGruposAction() {
  await assertAdmin()
  // Da credencial do Mercado Pago, só a conta e o documento do titular, para o resumo; o token nunca entra no select.
  const linhas = await db.select({
    g: grupos, contaNome: contas.nome, mpUserId: mercadopagoConfig.userId, mpTitular: mercadopagoConfig.titularDocumento,
  }).from(grupos)
    .innerJoin(contas, eq(contas.id, grupos.contaId))
    .leftJoin(mercadopagoConfig, eq(mercadopagoConfig.grupoId, grupos.id))
    .orderBy(grupos.nome)
  return linhas.map(({ g: { mcpaiEndpointUrl, ...g }, contaNome, mpUserId, mpTitular }) => ({
    ...g,
    contaNome,
    mcpaiConfigurado: !!mcpaiEndpointUrl,
    mcpaiResumo: mcpaiEndpointUrl ? resumoDaChave(mcpaiEndpointUrl) : null,
    ...credencialMpParaTela(mpUserId, mpTitular, g.cnpj),
  }))
}

function resumoDaChave(cifrado: string): string {
  try {
    return resumirEndpoint(decifrar(cifrado).toString('utf8'))
  } catch {
    // CERT_MASTER_KEY trocada ou valor corrompido: a tela precisa dizer que tem
    // algo salvo e que não serve, em vez de fingir que está tudo certo.
    return 'chave salva, mas ilegível — cadastre de novo'
  }
}

type GrupoInput = {
  nome: string
  cnpj: string
  ativo: boolean
  blingClientId?: string
  blingClientSecret?: string
  /**
   * URL do endpoint do mcp.ai desta empresa. Vazio NÃO apaga a chave que já
   * está salva: como o valor nunca volta para a tela (é credencial), um campo
   * em branco significa "não mexi nisso", não "apague". Para trocar, cola-se
   * a nova; para apagar, existe `mcpaiRemover`.
   */
  mcpaiEndpointUrl?: string
  mcpaiRemover?: boolean
  /**
   * Ids de contas do mcp.ai de outro CNPJ que entram na tela PIX (#236), só no Editar. Ausente não mexe; vazio
   * apaga. Recusado em grupo sem chave própria: na chave global (de outra empresa) o id nem pode existir.
   */
  mcpaiContasPix?: string
  /**
   * Access Token do Mercado Pago (só no Editar). Vazio não mexe; `mpRemover` apaga. Conferido no
   * Mercado Pago antes de gravar (src/lib/mercadopago/credencial.ts).
   */
  mpToken?: string
  mpRemover?: boolean
  // Qualificação da empresa no contrato de compra e venda. Sem os três, o envio
  // de contrato fica bloqueado neste grupo (ver @/lib/assinatura/documento).
  razaoSocial?: string
  enderecoSede?: string
  cidadeSede?: string
  comarcaForo?: string
}

/**
 * `undefined` = não mexer na coluna; `null` = apagar; string = novo valor
 * cifrado. A URL do mcp.ai carrega o segredo de acesso dentro dela, por isso
 * nunca é gravada em claro (mesmo cofre do certificado A1).
 */
function cifrarChaveMcp(dados: GrupoInput): string | null | undefined {
  if (dados.mcpaiRemover) return null
  const url = dados.mcpaiEndpointUrl?.trim()
  if (!url) return undefined
  if (!/^https:\/\//i.test(url)) {
    throw new RecusaUsuario('A chave do mcp.ai precisa ser a URL do endpoint, começando com https://')
  }
  return cifrar(url)
}

function exigirNomeECnpj(dados: Pick<GrupoInput, 'nome' | 'cnpj'>) {
  if (!dados.nome.trim()) throw new RecusaUsuario('Nome obrigatório')
  if (!dados.cnpj.trim()) throw new RecusaUsuario('CNPJ obrigatório')
}

// Sem o Mercado Pago: o campo só existe no Editar Grupo (decisão do Luis, #51).
type NovoGrupoInput = Omit<GrupoInput, 'mpToken' | 'mpRemover'> & { contaId?: string | null }

export async function criarGrupoAction(dados: NovoGrupoInput): Promise<ResultadoAction> {
  return acao(() => gravarNovoGrupo(dados))
}
async function gravarNovoGrupo(dados: NovoGrupoInput) {
  await assertAdmin()
  exigirNomeECnpj(dados)

  // Conta nova (padrão) ou uma existente escolhida pelo admin_geral (#199, ADR-0018).
  await db.transaction(async tx => {
    await criarGrupo(tx, {
      nome: dados.nome.trim(),
      cnpj: dados.cnpj.trim(),
      ativo: dados.ativo,
      blingClientId: dados.blingClientId?.trim() || null,
      blingClientSecret: dados.blingClientSecret?.trim() || null,
      mcpaiEndpointUrl: cifrarChaveMcp(dados) ?? null,
      razaoSocial: dados.razaoSocial?.trim() || null,
      enderecoSede: dados.enderecoSede?.trim() || null,
      cidadeSede: dados.cidadeSede?.trim() || null,
      comarcaForo: dados.comarcaForo?.trim() || null,
    }, dados.contaId || null)
  })
  revalidatePath('/admin/grupos')
  revalidatePath('/', 'layout')
}

export async function listarContasAction() {
  await assertAdmin()
  return contasParaNovoGrupo()
}

/** `aviso`: a credencial gravou, mas há o que conferir (CNPJ do titular diferente, decisão do Luis). */
export async function editarGrupoAction(id: string, dados: GrupoInput): Promise<ResultadoAction<{ aviso: string | null }>> {
  return acao(() => editarGrupo(id, dados))
}
async function editarGrupo(id: string, dados: GrupoInput) {
  const usuario = await assertAdmin()
  exigirNomeECnpj(dados)
  const [existe] = ehUuid(id) ? await db.select({ id: grupos.id, chave: grupos.mcpaiEndpointUrl }).from(grupos).where(eq(grupos.id, id)).limit(1) : []
  if (!existe) throw new RecusaUsuario('Grupo não encontrado')

  const chaveMcp = cifrarChaveMcp(dados)
  const idsPix = idsContasPixDoPedido({
    texto: dados.mcpaiContasPix, jaTinha: !!existe.chave, chaveNova: typeof chaveMcp === 'string', remover: chaveMcp === null,
  })
  if (!idsPix.ok) throw new RecusaUsuario(idsPix.erro)
  // O Mercado Pago é consultado antes, fora da transação; grupo e credencial gravam juntos ou nada grava.
  const mp = await conferirCredencialMp({ mpToken: dados.mpToken, mpRemover: dados.mpRemover }, dados.cnpj, DEPENDENCIAS_CREDENCIAL_MP)
  if (!mp.ok) throw new RecusaUsuario(mp.erro)

  await db.transaction(async tx => {
    await tx.update(grupos).set({
      nome: dados.nome.trim(),
      cnpj: dados.cnpj.trim(),
      ativo: dados.ativo,
      // Espalhamento condicional: sem chave nova e sem pedido de remoção, a
      // coluna nem entra no UPDATE — é o que faz "campo em branco" preservar a
      // credencial já cadastrada.
      ...(chaveMcp !== undefined ? { mcpaiEndpointUrl: chaveMcp } : {}),
      ...(idsPix.ids !== undefined ? { mcpaiContasPixIds: idsPix.ids } : {}),
      blingClientId: dados.blingClientId?.trim() || null,
      blingClientSecret: dados.blingClientSecret?.trim() || null,
      razaoSocial: dados.razaoSocial?.trim() || null,
      enderecoSede: dados.enderecoSede?.trim() || null,
      cidadeSede: dados.cidadeSede?.trim() || null,
      comarcaForo: dados.comarcaForo?.trim() || null,
    }).where(eq(grupos.id, id))
    await aplicarCredencialMp(tx, id, usuario.id, mp.plano)
  })
  revalidatePath('/admin/grupos')
  revalidatePath('/', 'layout')
  return { aviso: mp.plano.acao === 'gravar' ? mp.plano.aviso : null }
}

/** Contas com mais de um grupo e a chave de transferência entre grupos (#552). */
export async function listarContasTransferenciaAction() {
  await assertAdmin()
  const linhas = await db.select({ id: contas.id, nome: contas.nome, ligada: contas.transferenciaEntreGrupos, grupos: count(grupos.id) })
    .from(contas).innerJoin(grupos, eq(grupos.contaId, contas.id))
    .groupBy(contas.id, contas.nome, contas.transferenciaEntreGrupos)
    .orderBy(contas.nome)
  return linhas.filter(c => c.grupos > 1)
}

export async function alterarTransferenciaEntreGruposAction(contaId: string, ligada: boolean) {
  const usuario = await getUsuarioLogado()
  const r = await alterarTransferenciaEntreGrupos(usuario, contaId, ligada)
  if (r.ok) revalidatePath('/admin/grupos')
  return r
}

// ─── Mover grupo para outra Conta (#554) ─────────────────────────────────────

/** Contas ativas para onde um grupo pode ir, com os grupos de cada uma para reconhecer. */
export async function contasDestinoAction() {
  await assertAdmin()
  return db.select({
    id: contas.id,
    nome: contas.nome,
    grupos: sql<string[]>`coalesce(array_agg(${grupos.nome} order by ${grupos.nome}) filter (where ${grupos.id} is not null), '{}')`,
  }).from(contas).leftJoin(grupos, eq(grupos.contaId, contas.id))
    .where(isNull(contas.desativadaEm)).groupBy(contas.id).orderBy(asc(contas.nome))
}

/** Só leitura: o que iria junto e o que bloqueia. */
export async function previaMoverGrupoAction(grupoId: string, contaDestinoId: string) {
  await assertAdmin()
  return previaMoverGrupo(db, grupoId, contaDestinoId)
}

export async function moverGrupoAction(grupoId: string, contaDestinoId: string) {
  const u = await getUsuarioLogado()
  if (u.papel !== 'admin_geral') return { ok: false as const, erro: 'Acesso restrito ao Admin Geral', previa: null }
  const origem = await origemDaRequisicaoAtual()
  const r = await db.transaction(tx => moverGrupo(tx, u, grupoId, contaDestinoId, origem))
  if (r.ok) {
    revalidatePath('/admin/grupos')
    revalidatePath('/', 'layout')
  }
  return r
}

/**
 * O que a chave PRÓPRIA do grupo enxerga no mcp.ai, em rótulos para a tela mostrar ao lado de cada ID (#253).
 * Só `admin_geral`; o grupo é lido pelo id no servidor. Sem chave própria devolve vazio (a global é de outra
 * empresa). Nunca devolve a chave, número, agência nem CNPJ, e erro do mcp.ai sobe só como frase genérica.
 */
export async function rotulosDosIdsAction(grupoId: string): Promise<ResultadoAction<RotuloConta[]>> {
  return acao(() => rotulosDosIds(grupoId))
}
async function rotulosDosIds(grupoId: string): Promise<RotuloConta[]> {
  await assertAdmin()
  const chave = ehUuid(grupoId)
    ? await credencialMcpDoGrupoPorId(grupoId).catch(() => { throw new RecusaUsuario(FALHA_AO_ROTULAR) })
    : null
  if (!chave) throw new RecusaUsuario('Grupo não encontrado')
  if (!chave.url) return []
  const lido = await rotulosDasContasDaChave(chave.url)
  if (!lido.ok) throw new RecusaUsuario(lido.erro)
  return lido.rotulos
}
