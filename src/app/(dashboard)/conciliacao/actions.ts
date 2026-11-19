'use server'
import { acao, RecusaUsuario } from '@/lib/resultado-action'
import { maquininhasDoGrupo } from '@/lib/maquininhas'
import { gruposDoTerminalNaConta } from '@/lib/terminal-da-conta'
import { db } from '@/lib/db'
import { cartaoNaoEstornado, cartaoPendente, linhaDeCartao } from '@/lib/cartao-status'
import { conciliacoesCartao, pixRecebimentosMcp, vendas, modelos, motos, vendasPecas, ordensServico, clientes } from '@/lib/db/schema'
import { eq, and, or, desc, gte, sql, isNull, ilike, inArray } from 'drizzle-orm'
import { getUsuarioLogado } from '@/lib/auth'
import { podeAbrirRegistroDaLoja } from '@/lib/acesso-registro'
import { podeGerirConciliacao } from '@/lib/conciliacao-papeis'
import { getGrupoAtivo, listarLojaIdsDoGrupoAtivo } from '@/lib/grupo'
import { INICIO_CONCILIACAO, INICIO_CONCILIACAO_EM } from '@/lib/conciliacao-periodo'
import { ehTransferenciaInterna } from '@/lib/pix-internos'
import { alvoValido, tipoDoAlvo, type AlvoConciliacao, type AlvoTipo } from '@/lib/conciliacao-alvo'
import { desvincularPix, vincularPix } from '@/lib/pix-vinculo'
import { comForcado, pagamentosEfetivosOS, semForcado, type PgtoOS } from '@/lib/conciliacao-status'
import { extrairTerminalInfinityPay } from '@/lib/conciliacao-terminal'
import { casarPorAutorizacao, tiposDoPagamentoDaLinha } from '@/lib/conciliacao-casamento'
import { detectarFormato } from '@/lib/conciliacao-formato'
import type { TransacaoDoRelatorio } from '@/lib/conciliacao-cartao'
import { lerRelatorioCielo } from '@/lib/conciliacao-cielo'
import { lerRelatorioRede } from '@/lib/conciliacao-rede'
import { lerRelatorioRendimento } from '@/lib/conciliacao-rendimento'
import { grupos } from '@/lib/db/schema'
import { revalidatePath } from 'next/cache'

// Linha comum aos leitores de relatório, o que a gravação precisa de cada transação.
type LinhaRelatorio = {
  dataTransacao: string
  tipo: 'credito' | 'debito'
  bandeira: string
  parcelas: number
  autorizacao: string | null
  valorBruto: number
  valorLiquido: number
  nsu: string | null
  portador: string | null
  terminal: string | null
}

const comoLinhaDoRelatorio = (t: TransacaoDoRelatorio): LinhaRelatorio => ({
  dataTransacao: t.dataTransacao,
  tipo: t.tipo,
  bandeira: t.rawData.bandeira,
  parcelas: t.parcelas,
  autorizacao: t.autorizacao ?? null,
  valorBruto: t.valorBruto,
  valorLiquido: t.valorLiquido,
  nsu: t.nsu,
  portador: t.rawData.portador,
  terminal: t.rawData.serial,
})

// Operadoras cujo serial (aparelho, estabelecimento, conta) vem em coluna própria e cujo NSU é um
// código comprido: a trava de grupo errado procura só em rawData.serial, para um serial curto não
// casar por acaso com o meio de um código.
const SERIAL_SO_NA_COLUNA = ['cielo', 'rede', 'rendimento']

// ── Parser CSV InfinityPay ────────────────────────────────────────────────────

function parseCSVLine(line: string): string[] {
  const result: string[] = []
  let current = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') { inQuotes = !inQuotes }
    else if (ch === ',' && !inQuotes) { result.push(current.trim()); current = '' }
    else { current += ch }
  }
  result.push(current.trim())
  return result
}

function parseBRL(s: string): number {
  return parseFloat(s.replace(/\./g, '').replace(',', '.').replace(/[^0-9.\-]/g, '')) || 0
}

function parseInfinityPay(text: string) {
  const lines = text.trim().split(/\r?\n/)
  const rows = []
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue
    const c = parseCSVLine(lines[i])
    // c[7] = Status, c[1] = Meio
    if (c[7] !== 'Aprovada') continue
    if (!['Crédito', 'Débito'].includes(c[1])) continue

    const [dd, mm, yyyy] = (c[0].split(' ')[0]).split('/')
    rows.push({
      dataTransacao: `${yyyy}-${mm}-${dd}`,
      tipo:          c[1] === 'Débito' ? 'debito' as const : 'credito' as const,
      bandeira:      c[2],
      parcelas:      c[3] === 'À Vista' ? 1 : (parseInt(c[3], 10) || 1),
      autorizacao:   c[6] !== '000000' ? c[6] : null,
      valorBruto:    parseBRL(c[8]),
      valorLiquido:  parseBRL(c[9]),
      nsu:           c[13] || null,
      portador:      c[14] || null,
      terminal:      extrairTerminalInfinityPay(c[5]),
    })
  }
  return rows
}

function parsePagueVeloz(text: string) {
  const lines = text.trim().split(/\r?\n/)
  const rows = []
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue
    const c = lines[i].split(';')
    if (c[14]?.trim() !== 'Pago') continue

    const [dd, mm, yyyy] = (c[7] ?? '').split('/')
    rows.push({
      dataTransacao: `${yyyy}-${mm}-${dd}`,
      tipo:          'credito' as const,
      bandeira:      (c[10] ?? '').toLowerCase(),
      parcelas:      parseInt(c[11] ?? '1', 10) || 1,
      autorizacao:   c[3]?.trim() || null,
      valorBruto:    parseBRL(c[12] ?? '0'),
      valorLiquido:  parseBRL(c[13] ?? '0'),
      nsu:           c[0]?.trim() || null,  // Cod PagueVeloz é o ID único
      portador:      c[5]?.trim() || null,
      terminal:      null,                  // PagueVeloz não identifica o aparelho no arquivo
    })
  }
  return rows
}

function parseStone(text: string) {
  const lines = text.trim().split(/\r?\n/)
  const rows = []
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue
    const c = lines[i].split(';')
    if (c[15]?.trim() !== 'Aprovada') continue

    const [dataPart] = (c[2] ?? '').split(' ')
    const [dd, mm, yyyy] = (dataPart ?? '').split('/')
    const produto = (c[4] ?? '').toLowerCase()

    rows.push({
      dataTransacao: `${yyyy}-${mm}-${dd}`,
      tipo:          produto.includes('debito') ? 'debito' as const : 'credito' as const,
      bandeira:      (c[3] ?? '').toLowerCase(),
      parcelas:      parseInt(c[6] ?? '1', 10) || 1,
      autorizacao:   c[5]?.trim() || null,   // STONE ID — aparece no comprovante
      valorBruto:    parseBRL(c[7] ?? '0'),
      valorLiquido:  parseBRL(c[8] ?? '0'),
      nsu:           c[5]?.trim() || null,   // STONE ID para deduplicação
      portador:      c[12]?.trim() || null,  // número do cartão mascarado
      // Serial da maquininha (coluna "N DE SÉRIE"). Vazio em venda por e-commerce,
      // que não passa por aparelho. Usado pra barrar arquivo no grupo errado.
      terminal:      c[14]?.trim() || null,
    })
  }
  return rows
}

// ── Actions ──────────────────────────────────────────────────────────────────

// Recusa volta como valor: em produção a mensagem de erro lançado não chega à tela (#404).
export async function importarRelatorioAction(formData: FormData) {
  return acao(() => importarRelatorio(formData))
}
async function importarRelatorio(formData: FormData) {
  const usuario = await getUsuarioLogado()
  if (!['admin_geral', 'admin_socio'].includes(usuario.papel)) throw new RecusaUsuario('Sem permissão')
  const grupo = await getGrupoAtivo(usuario)
  const lojaIdsGrupo = await listarLojaIdsDoGrupoAtivo(usuario)

  const operadoraSelecionada = formData.get('operadora') as string
  const file = formData.get('file') as File
  if (!file || !operadoraSelecionada) throw new RecusaUsuario('Arquivo ou operadora não informados')

  // Tenta UTF-8; se falhar, tenta latin1 (comum em arquivos Windows brasileiros)
  let text: string
  try {
    const buf = await file.arrayBuffer()
    text = new TextDecoder('utf-8').decode(buf)
    if (text.includes('�')) text = new TextDecoder('latin1').decode(buf)
  } catch {
    text = await file.text()
  }

  // Auto-detecta o formato pelo cabeçalho
  const formatoDetectado = detectarFormato(text)
  const operadora = formatoDetectado ?? operadoraSelecionada

  if (formatoDetectado && formatoDetectado !== operadoraSelecionada) {
    console.log(`[conciliacao] formato detectado: ${formatoDetectado} (selecionado: ${operadoraSelecionada})`)
  }

  let rows: LinhaRelatorio[] = []
  let semCodigo = 0
  let incompletas = 0
  if (operadora === 'infinitypay')      rows = parseInfinityPay(text)
  else if (operadora === 'pagueveloz')  rows = parsePagueVeloz(text)
  else if (operadora === 'stone')       rows = parseStone(text)
  else if (operadora === 'cielo') {
    // Arquivo ruim volta como recusa aqui, antes de gravar qualquer linha (a importação não é transacional).
    const lido = lerRelatorioCielo(text)
    if (!lido.ok) throw new RecusaUsuario(lido.erro)
    rows = lido.transacoes.map(comoLinhaDoRelatorio)
    semCodigo = lido.semCodigo
  }
  else if (operadora === 'rede') {
    const lido = lerRelatorioRede(text)
    if (!lido.ok) throw new RecusaUsuario(lido.erro)
    rows = lido.transacoes.map(comoLinhaDoRelatorio)
    incompletas = lido.incompletas
  }
  else if (operadora === 'rendimento') {
    const lido = lerRelatorioRendimento(text)
    if (!lido.ok) throw new RecusaUsuario(lido.erro)
    rows = lido.transacoes.map(comoLinhaDoRelatorio)
  }
  else throw new RecusaUsuario(`Formato não reconhecido. Verifique se o arquivo é da operadora correta.`)
  if (!(await maquininhasDoGrupo(db, grupo.id)).some(m => m.operadora === operadora)) {
    throw new RecusaUsuario('Maquininha não encontrada')
  }

  // ── Trava de grupo errado ───────────────────────────────────────────────────
  // A importação carimba o grupo ATIVO na sessão. Se o arquivo for de outro
  // grupo, as transações ficam presas onde nenhuma venda pode alcançá-las — foi
  // o que aconteceu com uma transação de BH importada em Sul de Minas.
  // Cada maquininha pertence a um grupo, então o serial do aparelho denuncia o
  // engano antes de gravar qualquer coisa. O serial é achado por dois caminhos:
  // na InfinityPay ele vem embutido no NSU; na Stone, na Cielo, na Rede (estabelecimento) e na
  // Rendimento (conta da loja) vem na coluna própria e é guardado em rawData.serial. (A PagueVeloz
  // não traz serial no arquivo.)
  const terminais = [...new Set(rows.map(r => r.terminal).filter((t): t is string => !!t))]
  for (const terminal of terminais) {
    // Só a Conta do grupo ativo: terminal visto em outra Conta conta como desconhecido (#460).
    const vistos = grupo.contaId ? await gruposDoTerminalNaConta(db, grupo.contaId, terminal, { soSerial: SERIAL_SO_NA_COLUNA.includes(operadora) }) : []
    if (vistos.length > 0 && !vistos.includes(grupo.id)) {
      throw new RecusaUsuario('Esse relatório parece ser de outro grupo. Confira o grupo ativo; nada foi gravado.')
    }
  }

  let importadas = 0
  let duplicadas = 0
  let conciliadas = 0

  for (const r of rows) {
    if (!r.valorBruto || r.valorBruto <= 0) continue

    // Evita duplicata por NSU (Stone, PagueVeloz), Código da venda (Cielo) ou Código (Rendimento)
    if (r.nsu) {
      const [ex] = await db
        .select({ id: conciliacoesCartao.id })
        .from(conciliacoesCartao)
        .where(and(
          eq(conciliacoesCartao.grupoId, grupo.id),
          eq(conciliacoesCartao.operadora, operadora),
          eq(conciliacoesCartao.nsu, r.nsu),
        ))
        .limit(1)
      if (ex) { duplicadas++; continue }
    } else {
      // InfinityPay: NSU mascarado — deduplica por (operadora, data, valor_bruto, tipo, parcelas)
      const [ex] = await db
        .select({ id: conciliacoesCartao.id })
        .from(conciliacoesCartao)
        .where(and(
          eq(conciliacoesCartao.grupoId,        grupo.id),
          eq(conciliacoesCartao.operadora,      operadora),
          isNull(conciliacoesCartao.nsu),
          eq(conciliacoesCartao.dataTransacao,  r.dataTransacao),
          sql`${conciliacoesCartao.valorBruto}::numeric = ${r.valorBruto}`,
          eq(conciliacoesCartao.tipo,           r.tipo),
          eq(conciliacoesCartao.parcelas,       r.parcelas),
        ))
        .limit(1)
      if (ex) { duplicadas++; continue }
    }

    // Tenta auto-conciliar pela autorização registrada na venda (moto, peça ou OS), restrito ao grupo ativo
    const { vendaId, pecaVendaId, osId } = r.autorizacao
      ? await casarPorAutorizacao(db, lojaIdsGrupo, r.autorizacao)
      : { vendaId: null, pecaVendaId: null, osId: null }

    const matched = vendaId ?? pecaVendaId ?? osId
    await db.insert(conciliacoesCartao).values({
      grupoId:        grupo.id,
      operadora,
      dataTransacao:  r.dataTransacao,
      nsu:            r.nsu,
      autorizacao:    r.autorizacao,
      valorBruto:     String(r.valorBruto),
      valorLiquido:   r.valorLiquido != null ? String(r.valorLiquido) : null,
      parcelas:       r.parcelas,
      tipo:           r.tipo,
      status:         'aprovado',
      rawData:        { bandeira: r.bandeira, portador: r.portador, serial: r.terminal ?? null },
      ...(matched ? { vendaId, pecaVendaId, osId, conciliado: true, conciliadoEm: new Date() } : {}),
    })

    if (matched) conciliadas++
    else importadas++
  }

  revalidatePath('/conciliacao')
  return { importadas, duplicadas, conciliadas, semCodigo, incompletas }
}

// Linha de outro grupo, inexistente ou estornada recebem a mesma frase: estornada não se vincula
// (vincular poria o valor devolvido de volta nas somas), e a frase não revela mais que "não achei".
const CONCILIACAO_NAO_ENCONTRADA = 'Conciliação não encontrada'

export async function vincularVendaAction(conciliacaoId: string, alvoId: string, tipo: AlvoTipo = 'moto') {
  const usuario = await getUsuarioLogado()
  if (!podeGerirConciliacao(usuario.papel)) throw new Error('Sem permissão')
  const grupo = await getGrupoAtivo(usuario)
  const lojaIdsGrupo = await listarLojaIdsDoGrupoAtivo(usuario)

  if (tipo === 'peca') {
    const [pecaVenda] = await db.select({ id: vendasPecas.id }).from(vendasPecas)
      .where(and(eq(vendasPecas.id, alvoId), inArray(vendasPecas.lojaId, lojaIdsGrupo))).limit(1)
    if (!pecaVenda) {
      throw new Error('Venda de peça não pertence ao grupo ativo')
    }
    const atualizadas = await db.update(conciliacoesCartao)
      .set({ pecaVendaId: alvoId, vendaId: null, osId: null, conciliado: true, conciliadoEm: new Date() })
      .where(and(eq(conciliacoesCartao.id, conciliacaoId), eq(conciliacoesCartao.grupoId, grupo.id), cartaoNaoEstornado))
      .returning({ id: conciliacoesCartao.id })
    if (atualizadas.length === 0) throw new Error(CONCILIACAO_NAO_ENCONTRADA)
    revalidatePath('/conciliacao')
    return
  }

  if (tipo === 'os') {
    const [os] = await db.select({ id: ordensServico.id }).from(ordensServico)
      .where(and(eq(ordensServico.id, alvoId), inArray(ordensServico.lojaId, lojaIdsGrupo))).limit(1)
    if (!os) {
      throw new Error('Ordem de serviço não pertence ao grupo ativo')
    }
    const atualizadas = await db.update(conciliacoesCartao)
      .set({ osId: alvoId, vendaId: null, pecaVendaId: null, conciliado: true, conciliadoEm: new Date() })
      .where(and(eq(conciliacoesCartao.id, conciliacaoId), eq(conciliacoesCartao.grupoId, grupo.id), cartaoNaoEstornado))
      .returning({ id: conciliacoesCartao.id })
    if (atualizadas.length === 0) throw new Error(CONCILIACAO_NAO_ENCONTRADA)
    revalidatePath('/conciliacao')
    return
  }

  // Garante que a venda a ser vinculada pertence a uma loja do grupo ativo
  const [venda] = await db
    .select({ id: vendas.id })
    .from(vendas)
    .where(and(eq(vendas.id, alvoId), inArray(vendas.lojaId, lojaIdsGrupo)))
    .limit(1)
  if (!venda) {
    throw new Error('Venda não pertence ao grupo ativo')
  }

  const atualizadas = await db.update(conciliacoesCartao)
    .set({ vendaId: alvoId, pecaVendaId: null, osId: null, conciliado: true, conciliadoEm: new Date() })
    .where(and(eq(conciliacoesCartao.id, conciliacaoId), eq(conciliacoesCartao.grupoId, grupo.id), cartaoNaoEstornado))
    .returning({ id: conciliacoesCartao.id })

  if (atualizadas.length === 0) throw new Error(CONCILIACAO_NAO_ENCONTRADA)

  revalidatePath('/conciliacao')
}

export async function desvincularVendaAction(conciliacaoId: string) {
  const usuario = await getUsuarioLogado()
  if (!podeGerirConciliacao(usuario.papel)) throw new Error('Sem permissão')
  const grupo = await getGrupoAtivo(usuario)

  const atualizadas = await db.update(conciliacoesCartao)
    .set({ vendaId: null, pecaVendaId: null, osId: null, conciliado: false, conciliadoEm: null })
    // Estornada mantém o vínculo com a venda: desvincular recebe a mesma frase de linha inexistente.
    .where(and(eq(conciliacoesCartao.id, conciliacaoId), eq(conciliacoesCartao.grupoId, grupo.id), cartaoNaoEstornado))
    .returning({ id: conciliacoesCartao.id })

  if (atualizadas.length === 0) throw new Error(CONCILIACAO_NAO_ENCONTRADA)

  revalidatePath('/conciliacao')
}

export async function buscarConciliacoesPorValor(valor: number) {
  const usuario = await getUsuarioLogado()
  if (!podeGerirConciliacao(usuario.papel)) throw new Error('Sem permissão')
  const grupo = await getGrupoAtivo(usuario)

  return db
    .select({
      id:            conciliacoesCartao.id,
      operadora:     conciliacoesCartao.operadora,
      autorizacao:   conciliacoesCartao.autorizacao,
      valorBruto:    conciliacoesCartao.valorBruto,
      dataTransacao: conciliacoesCartao.dataTransacao,
      tipo:          conciliacoesCartao.tipo,
      rawData:       conciliacoesCartao.rawData,
    })
    .from(conciliacoesCartao)
    .where(
      and(
        eq(conciliacoesCartao.grupoId, grupo.id),
        // Fora do período de conciliação não é candidato — ver INICIO_CONCILIACAO.
        gte(conciliacoesCartao.dataTransacao, INICIO_CONCILIACAO),
        sql`${conciliacoesCartao.vendaId} IS NULL`,
        cartaoNaoEstornado,
        linhaDeCartao,
        sql`ABS(${conciliacoesCartao.valorBruto}::numeric - ${valor}) <= 0.05`,
      )
    )
    .orderBy(desc(conciliacoesCartao.dataTransacao))
    .limit(10)
}

// ─── Conciliação por alvo (venda de moto, peça ou OS) ────────────────────────
// As telas de vendas, peças e OS mostram o mesmo painel de pagamentos, então
// carregam os lançamentos pelas mesmas funções — ver src/components/pagamentos-conciliacao.tsx.

export type { AlvoConciliacao, AlvoTipo }

// O mesmo status de conciliação aparece em várias telas; todas revalidam juntas
// para nunca divergirem (uma dizendo "pendente" e a outra "conciliada").
function revalidatePathsConciliacao() {
  revalidatePath('/vendas')
  revalidatePath('/pecas')
  revalidatePath('/ordens-servico')
  revalidatePath('/dashboard')
  revalidatePath('/conciliacao')
  revalidatePath('/pix-mcp')
}

// Com `lojaIdsGrupo`, só acha o alvo dessas lojas (escopo dentro da consulta, como pagamentosDoAlvo).
async function lojaIdDoAlvo(alvo: AlvoConciliacao, lojaIdsGrupo?: string[]): Promise<string | null> {
  if (alvo.tipo === 'peca') {
    const [r] = await db.select({ lojaId: vendasPecas.lojaId }).from(vendasPecas)
      .where(and(eq(vendasPecas.id, alvo.id), lojaIdsGrupo && inArray(vendasPecas.lojaId, lojaIdsGrupo))).limit(1)
    return r?.lojaId ?? null
  }
  if (alvo.tipo === 'os') {
    const [r] = await db.select({ lojaId: ordensServico.lojaId }).from(ordensServico)
      .where(and(eq(ordensServico.id, alvo.id), lojaIdsGrupo && inArray(ordensServico.lojaId, lojaIdsGrupo))).limit(1)
    return r?.lojaId ?? null
  }
  const [r] = await db.select({ lojaId: vendas.lojaId }).from(vendas)
    .where(and(eq(vendas.id, alvo.id), lojaIdsGrupo && inArray(vendas.lojaId, lojaIdsGrupo))).limit(1)
  return r?.lojaId ?? null
}

// Quem não abre o alvo recebe o mesmo que o alvo inexistente (lista vazia): a resposta não revela
// que o registro existe. Alvo forjado (tipo fora da lista, id que não é uuid) também.
async function abreOAlvo(alvo: AlvoConciliacao): Promise<boolean> {
  const usuario = await getUsuarioLogado()
  if (!alvoValido(alvo)) return false
  const lojaId  = await lojaIdDoAlvo(alvo)
  if (!lojaId) return false
  return podeGerirConciliacao(usuario.papel) ? podeAbrirRegistroDaLoja(usuario, lojaId) : lojaId === usuario.lojaId
}

export async function buscarConciliacoesDoAlvo(alvo: AlvoConciliacao) {
  if (!(await abreOAlvo(alvo))) return []

  const coluna = alvo.tipo === 'peca' ? conciliacoesCartao.pecaVendaId
    : alvo.tipo === 'os'              ? conciliacoesCartao.osId
    :                                   conciliacoesCartao.vendaId

  return db
    .select({
      id:            conciliacoesCartao.id,
      autorizacao:   conciliacoesCartao.autorizacao,
      valorBruto:    conciliacoesCartao.valorBruto,
      valorLiquido:  conciliacoesCartao.valorLiquido,
      operadora:     conciliacoesCartao.operadora,
      tipo:          conciliacoesCartao.tipo,
      dataTransacao: conciliacoesCartao.dataTransacao,
    })
    .from(conciliacoesCartao)
    .where(and(eq(coluna, alvo.id), eq(conciliacoesCartao.conciliado, true)))
}

export async function buscarPixDoAlvo(alvo: AlvoConciliacao) {
  if (!(await abreOAlvo(alvo))) return []

  // Fonte única desde 15/09/2026: o PIX do ValidaPix saiu junto com a
  // integração. Venda de antes de julho/2026, cujo pagamento só existia lá,
  // aparece aqui sem PIX — o dado está em
  // backups/pix_recebimentos_validapix_20260915.json.
  const coluna = alvo.tipo === 'peca' ? pixRecebimentosMcp.pecaVendaId
    : alvo.tipo === 'os'              ? pixRecebimentosMcp.osId
    :                                   pixRecebimentosMcp.vendaId

  return db
    .select({
      id:            pixRecebimentosMcp.id,
      dataPagamento: pixRecebimentosMcp.data,
      valor:         pixRecebimentosMcp.valor,
      pagadorNome:   pixRecebimentosMcp.pagadorNome,
      observacao:    pixRecebimentosMcp.descricao,
    })
    .from(pixRecebimentosMcp)
    .where(eq(coluna, alvo.id))
}

// Busca livre: a lupa padrão só acha transação de valor praticamente idêntico. Quando
// o valor lançado na venda não bate com o que a operadora reportou (taxa embutida,
// digitação errada), é por aqui que se acha a transação — por autorização, NSU, data
// ou valor aproximado, sem filtro de valor exato.
export async function buscarConciliacoesLivres(query: string) {
  const usuario = await getUsuarioLogado()
  if (!podeGerirConciliacao(usuario.papel)) throw new Error('Sem permissão')
  const grupo = await getGrupoAtivo(usuario)

  const q = query.trim()
  if (q.length < 2) return []

  const valor   = parseFloat(q.replace(/\./g, '').replace(',', '.'))
  const isData  = /^\d{4}-\d{2}-\d{2}$/.test(q)
  const isValor = !isData && Number.isFinite(valor) && valor > 0

  const filtro = isData
    ? eq(conciliacoesCartao.dataTransacao, q)
    : isValor
      ? sql`ABS(${conciliacoesCartao.valorBruto}::numeric - ${valor}) <= 5`
      : sql`(${conciliacoesCartao.autorizacao} ILIKE ${'%' + q + '%'} OR ${conciliacoesCartao.nsu} ILIKE ${'%' + q + '%'})`

  return db
    .select({
      id:            conciliacoesCartao.id,
      operadora:     conciliacoesCartao.operadora,
      autorizacao:   conciliacoesCartao.autorizacao,
      valorBruto:    conciliacoesCartao.valorBruto,
      dataTransacao: conciliacoesCartao.dataTransacao,
      tipo:          conciliacoesCartao.tipo,
      rawData:       conciliacoesCartao.rawData,
    })
    .from(conciliacoesCartao)
    .where(and(
      eq(conciliacoesCartao.grupoId, grupo.id),
      gte(conciliacoesCartao.dataTransacao, INICIO_CONCILIACAO),
      cartaoPendente,
      linhaDeCartao,
      filtro,
    ))
    .orderBy(desc(conciliacoesCartao.dataTransacao))
    .limit(15)
}

// ─── PIX por alvo (venda de moto, peça ou OS) ────────────────────────────────
// O cartão sempre teve mão dupla: da venda dá pra achar a transação, e da transação
// dá pra achar a venda. O PIX só tinha um lado — quem quisesse conciliar um PIX
// precisava sair da venda, ir em /pix-mcp e digitar o número de cabeça. Estas duas
// funções fecham a outra mão, com as mesmas regras de grupo e papel do cartão.

/** Recebimento PIX ainda não vinculado a nada, do grupo ativo. */
export type PixLivre = {
  id: string
  data: Date
  valor: string
  pagadorNome: string | null
  descricao: string | null
}

/**
 * PIX livres pra conciliar com o alvo. Sem `query`, procura por valor aproximado
 * (o mesmo ±5 do cartão); com `query`, casa por pagador, descrição, data
 * (AAAA-MM-DD) ou valor.
 */
export async function buscarPixLivres(valor: number, query?: string): Promise<PixLivre[]> {
  const usuario = await getUsuarioLogado()
  if (!podeGerirConciliacao(usuario.papel)) throw new Error('Sem permissão')
  const grupo = await getGrupoAtivo(usuario)

  const q = (query ?? '').trim()
  let filtro
  if (!q) {
    filtro = sql`ABS(${pixRecebimentosMcp.valor}::numeric - ${valor}) <= 5`
  } else {
    const valorBusca = parseFloat(q.replace(/\./g, '').replace(',', '.'))
    if (/^\d{4}-\d{2}-\d{2}$/.test(q)) {
      filtro = sql`${pixRecebimentosMcp.data}::date = ${q}::date`
    } else if (Number.isFinite(valorBusca) && valorBusca > 0) {
      filtro = sql`ABS(${pixRecebimentosMcp.valor}::numeric - ${valorBusca}) <= 5`
    } else {
      filtro = or(
        ilike(pixRecebimentosMcp.pagadorNome, `%${q}%`),
        ilike(pixRecebimentosMcp.descricao, `%${q}%`),
      )
    }
  }

  const linhas = await db
    .select({
      id:          pixRecebimentosMcp.id,
      data:        pixRecebimentosMcp.data,
      valor:       pixRecebimentosMcp.valor,
      pagadorNome: pixRecebimentosMcp.pagadorNome,
      descricao:   pixRecebimentosMcp.descricao,
    })
    .from(pixRecebimentosMcp)
    .where(and(
      eq(pixRecebimentosMcp.grupoId, grupo.id),
      gte(pixRecebimentosMcp.data, INICIO_CONCILIACAO_EM),
      isNull(pixRecebimentosMcp.tipoCorrespondencia),
      filtro,
    ))
    .orderBy(desc(pixRecebimentosMcp.data))
    .limit(30)

  // Liquidação da maquininha e transferência entre contas do grupo não é dinheiro de
  // cliente — filtrar em JS porque a regra é de nome, não de coluna. Ver pix-internos.ts.
  return linhas.filter(l => !ehTransferenciaInterna(l.pagadorNome)).slice(0, 15)
}

// Recusa volta como valor: em produção a mensagem de erro lançado não chega à tela (#404).
export async function vincularPixAlvoAction(pixId: string, alvo: AlvoConciliacao) {
  return acao(() => vincularPixAlvo(pixId, alvo))
}
async function vincularPixAlvo(pixId: string, alvo: AlvoConciliacao) {
  const usuario = await getUsuarioLogado()
  if (!podeGerirConciliacao(usuario.papel)) throw new RecusaUsuario('Sem permissão')
  if (!alvoValido(alvo)) throw alvoNaoEncontrado(tipoDoAlvo(alvo))
  const grupo = await getGrupoAtivo(usuario)

  // O alvo só vale nas lojas do grupo do PIX (o ativo): nem outra Conta nem outro grupo da mesma Conta.
  const lojaIdsGrupo = await listarLojaIdsDoGrupoAtivo(usuario)
  if (!(await lojaIdDoAlvo(alvo, lojaIdsGrupo))) throw alvoNaoEncontrado(alvo.tipo)

  // `tipoCorrespondencia` usa 'venda' pra moto — é o enum que /pix-mcp já grava.
  const vinculo = alvo.tipo === 'peca' ? { tipo: 'peca' as const, pecaVendaId: alvo.id }
    : alvo.tipo === 'os'               ? { tipo: 'os' as const, osId: alvo.id }
    :                                    { tipo: 'venda' as const, vendaId: alvo.id }
  await vincularPix(pixId, grupo.id, vinculo, usuario.id)

  revalidatePathsConciliacao()
}

export async function desvincularPixAlvoAction(pixId: string) {
  return acao(() => desvincularPixAlvo(pixId))
}
async function desvincularPixAlvo(pixId: string) {
  const usuario = await getUsuarioLogado()
  if (!podeGerirConciliacao(usuario.papel)) throw new RecusaUsuario('Sem permissão')
  const grupo = await getGrupoAtivo(usuario)
  await desvincularPix(pixId, grupo.id)
  revalidatePathsConciliacao()
}

// ─── Forçar conciliação na mão ───────────────────────────────────────────────
// Fecha a pendência quando o dinheiro entrou mas não existe lançamento no sistema.
// Quem gere a conciliação força e desfaz (podeGerirConciliacao, #79).
// A marcação mora no próprio item do array `pagamentos` — ver
// docs/superpowers/specs/2026-07-31-forcar-conciliacao-design.md.

// Registro de outro grupo (ou de outra Conta) e id inexistente recebem a mesma frase: a
// resposta não pode revelar que o registro existe.
function alvoNaoEncontrado(tipo: AlvoTipo) {
  return new RecusaUsuario(tipo === 'peca' ? 'Venda de peça não encontrada'
    : tipo === 'os'                         ? 'Ordem de serviço não encontrada'
    :                                         'Venda não encontrada')
}

// Pagamentos do alvo, só se ele for de uma loja do grupo ativo (escopo dentro da consulta).
async function pagamentosDoAlvo(alvo: AlvoConciliacao, lojaIdsGrupo: string[]): Promise<PgtoOS[] | null> {
  if (alvo.tipo === 'peca') {
    const [r] = await db
      .select({ pagamentos: vendasPecas.pagamentos })
      .from(vendasPecas)
      .where(and(eq(vendasPecas.id, alvo.id), inArray(vendasPecas.lojaId, lojaIdsGrupo)))
      .limit(1)
    return r ? ((r.pagamentos ?? []) as PgtoOS[]) : null
  }

  if (alvo.tipo === 'os') {
    const [r] = await db
      .select({
        pagamentos:     ordensServico.pagamentos,
        formaPagamento: ordensServico.formaPagamento,
        valorTotal:     ordensServico.valorTotal,
      })
      .from(ordensServico)
      .where(and(eq(ordensServico.id, alvo.id), inArray(ordensServico.lojaId, lojaIdsGrupo)))
      .limit(1)
    // OS antiga só tem `formaPagamento` em texto — materializa o array sintetizado
    // para que a marcação tenha onde morar.
    return r ? pagamentosEfetivosOS(r.formaPagamento, r.pagamentos, r.valorTotal) : null
  }

  const [r] = await db
    .select({ pagamentos: vendas.pagamentos })
    .from(vendas)
    .where(and(eq(vendas.id, alvo.id), inArray(vendas.lojaId, lojaIdsGrupo)))
    .limit(1)
  return r ? ((r.pagamentos ?? []) as PgtoOS[]) : null
}

async function alvoParaEdicao(alvo: AlvoConciliacao) {
  const usuario = await getUsuarioLogado()
  if (!podeGerirConciliacao(usuario.papel)) throw new RecusaUsuario('Sem permissão')
  if (!alvoValido(alvo)) throw alvoNaoEncontrado(tipoDoAlvo(alvo))

  const lojaIdsGrupo = await listarLojaIdsDoGrupoAtivo(usuario)
  const pgtos = await pagamentosDoAlvo(alvo, lojaIdsGrupo)
  if (!pgtos) throw alvoNaoEncontrado(alvo.tipo)
  return { usuario, lojaIdsGrupo, pgtos }
}

// Grava com o mesmo escopo da leitura: o update não confia só no id.
async function gravarPagamentos(alvo: AlvoConciliacao, lojaIdsGrupo: string[], pgtos: PgtoOS[]) {
  if (alvo.tipo === 'peca') {
    await db.update(vendasPecas).set({ pagamentos: pgtos })
      .where(and(eq(vendasPecas.id, alvo.id), inArray(vendasPecas.lojaId, lojaIdsGrupo)))
  } else if (alvo.tipo === 'os') {
    await db.update(ordensServico).set({ pagamentos: pgtos })
      .where(and(eq(ordensServico.id, alvo.id), inArray(ordensServico.lojaId, lojaIdsGrupo)))
    revalidatePath(`/ordens-servico/${alvo.id}`)
  } else {
    await db.update(vendas).set({ pagamentos: pgtos })
      .where(and(eq(vendas.id, alvo.id), inArray(vendas.lojaId, lojaIdsGrupo)))
  }

  revalidatePathsConciliacao()
}

// Recusa volta como valor: em produção a mensagem de erro lançado não chega à tela (#404).
export async function forcarConciliacaoAction(alvo: AlvoConciliacao, idx: number, motivo: string) {
  return acao(() => forcarConciliacao(alvo, idx, motivo))
}
async function forcarConciliacao(alvo: AlvoConciliacao, idx: number, motivo: string) {
  const { usuario, lojaIdsGrupo, pgtos } = await alvoParaEdicao(alvo)
  const r = comForcado(pgtos, idx, motivo, { porId: usuario.id, porNome: usuario.nome, em: new Date().toISOString() })
  if (!r.ok) throw new RecusaUsuario(r.erro)
  await gravarPagamentos(alvo, lojaIdsGrupo, r.dados)
}

export async function desfazerConciliacaoForcadaAction(alvo: AlvoConciliacao, idx: number) {
  return acao(() => desfazerConciliacaoForcada(alvo, idx))
}
async function desfazerConciliacaoForcada(alvo: AlvoConciliacao, idx: number) {
  const { lojaIdsGrupo, pgtos } = await alvoParaEdicao(alvo)
  const r = semForcado(pgtos, idx)
  if (!r.ok) throw new RecusaUsuario(r.erro)
  await gravarPagamentos(alvo, lojaIdsGrupo, r.dados)
}

export async function buscarVendasParaVincular(conciliacaoId: string) {
  const usuario = await getUsuarioLogado()
  // Mesmos papéis de quem vincula (vincularVendaAction) e da busca manual: a lista traz cliente e valor.
  if (!podeGerirConciliacao(usuario.papel)) throw new Error('Sem permissão')
  const grupo = await getGrupoAtivo(usuario)
  // Valor e tipo saem da linha, lida com o grupo no where: linha de outra Conta, inexistente ou estornada
  // (o vincular recusa) dão lista vazia.
  const [linha] = await db.select({ valorBruto: conciliacoesCartao.valorBruto, tipo: conciliacoesCartao.tipo })
    .from(conciliacoesCartao)
    .where(and(eq(conciliacoesCartao.id, conciliacaoId), eq(conciliacoesCartao.grupoId, grupo.id), cartaoNaoEstornado))
    .limit(1)
  if (!linha) return []
  const valorRef = Number(linha.valorBruto)
  const tipos = [...tiposDoPagamentoDaLinha(linha.tipo)]
  const lojaIdsGrupo = await listarLojaIdsDoGrupoAtivo(usuario)

  // Busca vendas (motos, peças/acessórios e OS) onde algum lançamento do tipo que a linha cobre
  // (cartão, ou Pix para a linha pix do Mercado Pago) tem valor exato (tolerância de R$0,01),
  // restrito às lojas do grupo ativo do usuário.
  const [motosRows, pecasRows, osRows] = await Promise.all([
    db
      .select({
        id:             vendas.id,
        tipo:           sql<'moto'>`'moto'`,
        numero:         vendas.numero,
        dataVenda:      vendas.dataVenda,
        clienteNome:    vendas.clienteNome,
        valor:          vendas.valor,
        formaPagamento: vendas.formaPagamento,
        pagamentos:     vendas.pagamentos,
      })
      .from(vendas)
      .where(
        and(
          inArray(vendas.lojaId, lojaIdsGrupo),
          sql`EXISTS (
            SELECT 1 FROM jsonb_array_elements(${vendas.pagamentos}) AS p
            WHERE (p->>'valor')::numeric BETWEEN ${valorRef - 0.01} AND ${valorRef + 0.01}
            AND p->>'tipo' IN ${tipos}
          )`,
        )
      )
      .orderBy(desc(vendas.dataVenda))
      .limit(50),
    db
      .select({
        id:             vendasPecas.id,
        tipo:           sql<'peca'>`'peca'`,
        numero:         vendasPecas.numero,
        dataVenda:      vendasPecas.dataVenda,
        clienteNome:    sql<string>`COALESCE(${vendasPecas.clienteNome}, 'Cliente não identificado')`,
        valor:          vendasPecas.valorTotal,
        formaPagamento: vendasPecas.formaPagamento,
        pagamentos:     vendasPecas.pagamentos,
      })
      .from(vendasPecas)
      .where(
        and(
          inArray(vendasPecas.lojaId, lojaIdsGrupo),
          sql`EXISTS (
            SELECT 1 FROM jsonb_array_elements(${vendasPecas.pagamentos}) AS p
            WHERE (p->>'valor')::numeric BETWEEN ${valorRef - 0.01} AND ${valorRef + 0.01}
            AND p->>'tipo' IN ${tipos}
          )`,
        )
      )
      .orderBy(desc(vendasPecas.dataVenda))
      .limit(50),
    db
      .select({
        id:             ordensServico.id,
        tipo:           sql<'os'>`'os'`,
        numero:         ordensServico.numero,
        dataVenda:      ordensServico.dataConclusao,
        clienteNome:    sql<string>`COALESCE(${clientes.nome}, ${ordensServico.clienteNomeExterno}, 'Cliente não identificado')`,
        valor:          ordensServico.valorTotal,
        formaPagamento: ordensServico.formaPagamento,
        pagamentos:     ordensServico.pagamentos,
      })
      .from(ordensServico)
      .leftJoin(clientes, eq(ordensServico.clienteId, clientes.id))
      .where(
        and(
          inArray(ordensServico.lojaId, lojaIdsGrupo),
          sql`EXISTS (
            SELECT 1 FROM jsonb_array_elements(${ordensServico.pagamentos}) AS p
            WHERE (p->>'valor')::numeric BETWEEN ${valorRef - 0.01} AND ${valorRef + 0.01}
            AND p->>'tipo' IN ${tipos}
          )`,
        )
      )
      .orderBy(desc(ordensServico.dataConclusao))
      .limit(50),
  ])

  return [...motosRows, ...pecasRows, ...osRows]
}

export async function buscarVendaManual(query: string) {
  const usuario = await getUsuarioLogado()
  if (!podeGerirConciliacao(usuario.papel)) throw new Error('Sem permissão')
  const lojaIdsGrupo = await listarLojaIdsDoGrupoAtivo(usuario)

  const q = query.trim()
  if (q.length < 2) return []

  const isNumero = /^\d{1,7}$/.test(q)

  const [motosRows, pecasRows, osRows] = await Promise.all([
    db
      .select({
        id:             vendas.id,
        tipo:           sql<'moto'>`'moto'`,
        numero:         vendas.numero,
        dataVenda:      vendas.dataVenda,
        clienteNome:    vendas.clienteNome,
        valor:          vendas.valor,
        formaPagamento: vendas.formaPagamento,
        pagamentos:     vendas.pagamentos,
      })
      .from(vendas)
      .where(
        and(
          inArray(vendas.lojaId, lojaIdsGrupo),
          isNumero ? eq(vendas.numero, parseInt(q, 10)) : ilike(vendas.clienteNome, `%${q}%`),
        )
      )
      .orderBy(desc(vendas.dataVenda))
      .limit(15),
    db
      .select({
        id:             vendasPecas.id,
        tipo:           sql<'peca'>`'peca'`,
        numero:         vendasPecas.numero,
        dataVenda:      vendasPecas.dataVenda,
        clienteNome:    sql<string>`COALESCE(${vendasPecas.clienteNome}, 'Cliente não identificado')`,
        valor:          vendasPecas.valorTotal,
        formaPagamento: vendasPecas.formaPagamento,
        pagamentos:     vendasPecas.pagamentos,
      })
      .from(vendasPecas)
      .where(
        and(
          inArray(vendasPecas.lojaId, lojaIdsGrupo),
          isNumero ? eq(vendasPecas.numero, parseInt(q, 10)) : ilike(sql`COALESCE(${vendasPecas.clienteNome}, '')`, `%${q}%`),
        )
      )
      .orderBy(desc(vendasPecas.dataVenda))
      .limit(15),
    db
      .select({
        id:             ordensServico.id,
        tipo:           sql<'os'>`'os'`,
        numero:         ordensServico.numero,
        dataVenda:      ordensServico.dataConclusao,
        clienteNome:    sql<string>`COALESCE(${clientes.nome}, ${ordensServico.clienteNomeExterno}, 'Cliente não identificado')`,
        valor:          ordensServico.valorTotal,
        formaPagamento: ordensServico.formaPagamento,
        pagamentos:     ordensServico.pagamentos,
      })
      .from(ordensServico)
      .leftJoin(clientes, eq(ordensServico.clienteId, clientes.id))
      .where(
        and(
          inArray(ordensServico.lojaId, lojaIdsGrupo),
          isNumero
            ? eq(ordensServico.numero, parseInt(q, 10))
            : sql`(COALESCE(${clientes.nome}, ${ordensServico.clienteNomeExterno}, '') ILIKE ${'%' + q + '%'})`,
        )
      )
      .orderBy(desc(ordensServico.dataConclusao))
      .limit(15),
  ])

  return [...motosRows, ...pecasRows, ...osRows]
}
