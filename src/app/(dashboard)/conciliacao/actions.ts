'use server'
import { acao, RecusaUsuario } from '@/lib/resultado-action'
import { maquininhasDoGrupo } from '@/lib/maquininhas'
import { gruposDoTerminalNaConta } from '@/lib/terminal-da-conta'
import { db } from '@/lib/db'
import { cartaoNaoEstornado, cartaoPendente, linhaDoPagamento } from '@/lib/cartao-status'
import { conciliacoesCartao, pixRecebimentosMcp, vendas, modelos, motos, vendasPecas, ordensServico, clientes } from '@/lib/db/schema'
import { eq, and, or, desc, gte, sql, isNull, ilike, inArray, type SQL } from 'drizzle-orm'
import { getUsuarioLogado } from '@/lib/auth'
import { podeAbrirRegistroDaLoja } from '@/lib/acesso-registro'
import { podeGerirConciliacao } from '@/lib/conciliacao-papeis'
import { getGrupoAtivo, listarLojaIdsDoGrupoAtivo } from '@/lib/grupo'
import { INICIO_CONCILIACAO, INICIO_CONCILIACAO_EM } from '@/lib/conciliacao-periodo'
import { ehTransferenciaInterna } from '@/lib/pix-internos'
import { alvoValido, colunasDoAlvo, semAlvos, tipoDoAlvo, type AlvoConciliacao, type AlvoTipo } from '@/lib/conciliacao-alvo'
import { ehUuid } from '@/lib/uuid'
import { desvincularPix, vincularPix } from '@/lib/pix-vinculo'
import { esperadoComTaxa, OPERACAO_COM_CUSTO } from '@/lib/custo-pix'
import { custoPixTaxaDoGrupo } from '@/lib/custo-pix-grupo'
import { comForcado, matchPagamentos, semForcado, type PgtoOS } from '@/lib/conciliacao-status'
import { extrairTerminalInfinityPay } from '@/lib/conciliacao-terminal'
import { casarPorAutorizacao, linhaDaTransacao } from '@/lib/conciliacao-casamento'
import { tiposDoPagamentoDaLinha } from '@/lib/conciliacao-status'
import { detectarFormato } from '@/lib/conciliacao-formato'
import { ehLinhaProcurada, type LinhaProcurada, type TransacaoDoRelatorio } from '@/lib/conciliacao-cartao'
import { lerRelatorioCielo } from '@/lib/conciliacao-cielo'
import { lerRelatorioRede } from '@/lib/conciliacao-rede'
import { lerRelatorioRendimento } from '@/lib/conciliacao-rendimento'
import { grupos } from '@/lib/db/schema'
import { revalidatePath } from 'next/cache'
import { revalidarTelasDaConciliacao } from '@/lib/revalidar-conciliacao'
import { cartoesDoAlvo, estornosDoAlvo, gravarPagamentosDoAlvo, pagamentosDoAlvo, pixDoAlvo } from '@/lib/alvo-da-conciliacao'
import { lojasDoEscopo } from '@/lib/conta'
import type { AnyPgColumn } from 'drizzle-orm/pg-core'

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
  // Quem gere a conciliação importa o relatório, o aux_adm inclusive (decisão do Luis, 19/11/2026, #51).
  if (!podeGerirConciliacao(usuario.papel)) throw new RecusaUsuario('Sem permissão')
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
    const alvos = r.autorizacao ? await casarPorAutorizacao(db, lojaIdsGrupo, r.autorizacao) : semAlvos()
    const transacao = {
      nsu:           r.nsu ?? undefined,
      autorizacao:   r.autorizacao ?? undefined,
      dataTransacao: r.dataTransacao,
      valorBruto:    r.valorBruto,
      valorLiquido:  r.valorLiquido,
      parcelas:      r.parcelas,
      tipo:          r.tipo,
      status:        'aprovado',
      rawData:       { bandeira: r.bandeira, portador: r.portador, serial: r.terminal ?? null },
    }
    const linha = linhaDaTransacao(grupo.id, operadora, transacao, alvos, new Date())
    await db.insert(conciliacoesCartao).values(linha)

    if (linha.conciliado) conciliadas++
    else importadas++
  }

  revalidatePath('/conciliacao')
  return { importadas, duplicadas, conciliadas, semCodigo, incompletas }
}

// Linha de outro grupo, inexistente ou estornada recebem a mesma frase: estornada não se vincula
// (vincular poria o valor devolvido de volta nas somas), e a frase não revela mais que "não achei".
const CONCILIACAO_NAO_ENCONTRADA = 'Conciliação não encontrada'

// Recusa volta como valor: em produção a mensagem de erro lançado não chega à tela (#404, #129).
export async function vincularVendaAction(conciliacaoId: string, alvo: AlvoConciliacao) {
  return acao(() => vincularVenda(conciliacaoId, alvo))
}
async function vincularVenda(conciliacaoId: string, alvo: AlvoConciliacao) {
  const usuario = await exigirAlvoNoGrupoAtivo(alvo)
  const grupo = await getGrupoAtivo(usuario)

  const atualizadas = ehUuid(conciliacaoId)
    ? await db.update(conciliacoesCartao)
      .set({ ...colunasDoAlvo(alvo), conciliado: true, conciliadoEm: new Date() })
      .where(and(eq(conciliacoesCartao.id, conciliacaoId), eq(conciliacoesCartao.grupoId, grupo.id), cartaoNaoEstornado))
      .returning({ id: conciliacoesCartao.id })
    : []
  if (atualizadas.length === 0) throw new RecusaUsuario(CONCILIACAO_NAO_ENCONTRADA)

  revalidarTelasDaConciliacao(alvo)
}

export async function desvincularVendaAction(conciliacaoId: string) {
  return acao(() => desvincularVenda(conciliacaoId))
}
async function desvincularVenda(conciliacaoId: string) {
  const usuario = await getUsuarioLogado()
  if (!podeGerirConciliacao(usuario.papel)) throw new RecusaUsuario('Sem permissão')
  const grupo = await getGrupoAtivo(usuario)

  const atualizadas = ehUuid(conciliacaoId)
    ? await db.update(conciliacoesCartao)
      .set({ ...semAlvos(), conciliado: false, conciliadoEm: null })
      // Estornada mantém o vínculo com a venda: desvincular recebe a mesma frase de linha inexistente.
      .where(and(eq(conciliacoesCartao.id, conciliacaoId), eq(conciliacoesCartao.grupoId, grupo.id), cartaoNaoEstornado))
      .returning({ id: conciliacoesCartao.id })
    : []
  if (atualizadas.length === 0) throw new RecusaUsuario(CONCILIACAO_NAO_ENCONTRADA)

  revalidarTelasDaConciliacao()
}

/** Linhas pendentes no valor do pagamento; `linha`: a que cobre o pagamento (cartão ou a pix da maquininha). */
export async function buscarConciliacoesPorValor(valor: number, linha: LinhaProcurada = 'cartao') {
  const usuario = await getUsuarioLogado()
  if (!podeGerirConciliacao(usuario.papel)) throw new Error('Sem permissão')
  if (!ehLinhaProcurada(linha)) throw new Error('Linha inválida')
  const grupo = await getGrupoAtivo(usuario)

  return db
    .select({
      id:            conciliacoesCartao.id,
      operadora:     conciliacoesCartao.operadora,
      autorizacao:   conciliacoesCartao.autorizacao,
      nsu:           conciliacoesCartao.nsu,
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
        // Sem nenhum vínculo (venda, peça ou OS) e não estornada: vincular não rouba o vínculo de outra.
        cartaoPendente,
        linhaDoPagamento(linha),
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

// Loja do alvo, já com as lojas permitidas no where: as do grupo ativo (gravação) ou o escopo da Conta (leitura do
// painel); sem filtro só para o admin_geral. Alvo fora delas e alvo inexistente dão o mesmo null.
async function lojaIdDoAlvo(alvo: AlvoConciliacao, lojas: Parameters<typeof inArray>[1] | undefined): Promise<string | null> {
  const naLoja = (coluna: AnyPgColumn) => (lojas ? inArray(coluna, lojas) : undefined)
  if (alvo.tipo === 'peca') {
    const [r] = await db.select({ lojaId: vendasPecas.lojaId }).from(vendasPecas)
      .where(and(eq(vendasPecas.id, alvo.id), naLoja(vendasPecas.lojaId))).limit(1)
    return r?.lojaId ?? null
  }
  if (alvo.tipo === 'os') {
    const [r] = await db.select({ lojaId: ordensServico.lojaId }).from(ordensServico)
      .where(and(eq(ordensServico.id, alvo.id), naLoja(ordensServico.lojaId))).limit(1)
    return r?.lojaId ?? null
  }
  const [r] = await db.select({ lojaId: vendas.lojaId }).from(vendas)
    .where(and(eq(vendas.id, alvo.id), naLoja(vendas.lojaId))).limit(1)
  return r?.lojaId ?? null
}

// Quem não abre o alvo recebe o mesmo que o alvo inexistente (lista vazia): a resposta não revela que o registro
// existe. Alvo forjado (tipo fora da lista, id que não é uuid) também. A Conta (ou o grupo da persona) entra no where
// de `lojaIdDoAlvo`; a regra de grupo por papel (podeVerGrupo) vem depois, sobre uma loja da Conta.
async function abreOAlvo(alvo: AlvoConciliacao): Promise<boolean> {
  const usuario = await getUsuarioLogado()
  if (!alvoValido(alvo)) return false
  const lojaId  = await lojaIdDoAlvo(alvo, usuario.papel === 'admin_geral' ? undefined : lojasDoEscopo(usuario))
  if (!lojaId) return false
  return podeGerirConciliacao(usuario.papel) ? podeAbrirRegistroDaLoja(usuario, lojaId) : lojaId === usuario.lojaId
}

export async function buscarConciliacoesDoAlvo(alvo: AlvoConciliacao) {
  if (!(await abreOAlvo(alvo))) return []
  return cartoesDoAlvo(alvo)
}

/** Linhas da maquininha ligadas ao alvo e estornadas no Mercado Pago (#51): o painel diz que o pagamento voltou. */
export async function buscarEstornosDoAlvo(alvo: AlvoConciliacao) {
  if (!(await abreOAlvo(alvo))) return []
  return estornosDoAlvo(alvo)
}

export async function buscarPixDoAlvo(alvo: AlvoConciliacao) {
  if (!(await abreOAlvo(alvo))) return []
  return pixDoAlvo(alvo)
}


// Busca livre: a lupa padrão só acha transação de valor praticamente idêntico. Quando
// o valor lançado na venda não bate com o que a operadora reportou (taxa embutida,
// digitação errada), é por aqui que se acha a transação — por autorização, NSU, data
// ou valor aproximado, sem filtro de valor exato.
export async function buscarConciliacoesLivres(query: string, linha: LinhaProcurada = 'cartao') {
  const usuario = await getUsuarioLogado()
  if (!podeGerirConciliacao(usuario.papel)) throw new Error('Sem permissão')
  if (!ehLinhaProcurada(linha)) throw new Error('Linha inválida')
  const grupo = await getGrupoAtivo(usuario)

  const q = query.trim()
  if (q.length < 2) return []

  const valor   = parseFloat(q.replace(/\./g, '').replace(',', '.'))
  const isData  = /^\d{4}-\d{2}-\d{2}$/.test(q)
  const isValor = !isData && Number.isFinite(valor) && valor > 0

  const porTexto = sql`(${conciliacoesCartao.autorizacao} ILIKE ${'%' + q + '%'} OR ${conciliacoesCartao.nsu} ILIKE ${'%' + q + '%'})`
  const porValor = sql`ABS(${conciliacoesCartao.valorBruto}::numeric - ${valor}) <= 5`
  // Só dígitos pode ser valor ou NSU/autorização (o NSU do Mercado Pago é só dígitos): procura nos dois.
  const filtro = isData
    ? eq(conciliacoesCartao.dataTransacao, q)
    : isValor
      ? (/^\d+$/.test(q) ? or(porValor, porTexto) : porValor)
      : porTexto

  return db
    .select({
      id:            conciliacoesCartao.id,
      operadora:     conciliacoesCartao.operadora,
      autorizacao:   conciliacoesCartao.autorizacao,
      nsu:           conciliacoesCartao.nsu,
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
      linhaDoPagamento(linha),
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

type Usuario = Awaited<ReturnType<typeof getUsuarioLogado>>

/** O alvo só vale nas lojas do grupo ativo, o grupo do PIX: nem outra Conta nem outro grupo da mesma Conta. */
async function alvoNoGrupoAtivo(usuario: Usuario, alvo: AlvoConciliacao): Promise<boolean> {
  return alvoValido(alvo) && (await lojaIdDoAlvo(alvo, await listarLojaIdsDoGrupoAtivo(usuario))) !== null
}

/** Quem grava no alvo (cartão, PIX, forçar): gere a conciliação e o alvo está no grupo ativo; senão recusa. */
async function exigirAlvoNoGrupoAtivo(alvo: AlvoConciliacao): Promise<Usuario> {
  const usuario = await getUsuarioLogado()
  if (!podeGerirConciliacao(usuario.papel)) throw new RecusaUsuario('Sem permissão')
  if (!(await alvoNoGrupoAtivo(usuario, alvo))) throw alvoNaoEncontrado(tipoDoAlvo(alvo))
  return usuario
}


/** PIX livres do grupo (sem vínculo, desde o início da conciliação), sem transferência interna. */
async function pixLivresDoGrupo(grupoId: string, filtro: SQL | undefined): Promise<PixLivre[]> {
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
      eq(pixRecebimentosMcp.grupoId, grupoId),
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

/**
 * O que a tela mostra ao abrir um pagamento PIX do alvo (#90): o valor esperado no banco (null sem custo
 * do PIX no grupo), se o alvo é do grupo ativo e os PIX livres de valor próximo (± R$ 5, o mesmo do cartão):
 * a linha PIX pelo esperado, a TED ou linha sem tipo pelo valor cheio. Fora do grupo ativo não lista nada:
 * vincular e forçar só valem no grupo do PIX.
 */
export async function buscarPixParaOAlvo(alvo: AlvoConciliacao, valor: number): Promise<{ esperado: number | null; taxa: number; noGrupoAtivo: boolean; pix: PixLivre[] }> {
  const usuario = await getUsuarioLogado()
  if (!podeGerirConciliacao(usuario.papel)) throw new Error('Sem permissão')
  const grupo = await getGrupoAtivo(usuario)
  const [noGrupoAtivo, taxa] = await Promise.all([alvoNoGrupoAtivo(usuario, alvo), custoPixTaxaDoGrupo(grupo.id)])
  // A taxa vai junto para a tela preencher o forçar de PIX com o esperado do que falta (#92).
  const esperado = esperadoComTaxa(valor, taxa)
  if (!noGrupoAtivo) return { esperado, taxa, noGrupoAtivo, pix: [] }
  const filtro = sql`ABS(${pixRecebimentosMcp.valor}::numeric
    - CASE WHEN ${pixRecebimentosMcp.tipoOperacao} = ${OPERACAO_COM_CUSTO} THEN ${esperado ?? valor}::numeric ELSE ${valor}::numeric END) <= 5`
  return { esperado, taxa, noGrupoAtivo, pix: await pixLivresDoGrupo(grupo.id, filtro) }
}

/** Busca digitada de PIX livres: pagador, descrição, data (AAAA-MM-DD) ou valor, como o crédito aparece no extrato. */
export async function buscarPixLivres(query: string): Promise<PixLivre[]> {
  const usuario = await getUsuarioLogado()
  if (!podeGerirConciliacao(usuario.papel)) throw new Error('Sem permissão')
  const grupo = await getGrupoAtivo(usuario)

  const q = query.trim()
  const valorBusca = parseFloat(q.replace(/\./g, '').replace(',', '.'))
  const filtro = /^\d{4}-\d{2}-\d{2}$/.test(q)
    ? sql`${pixRecebimentosMcp.data}::date = ${q}::date`
    : Number.isFinite(valorBusca) && valorBusca > 0
      ? sql`ABS(${pixRecebimentosMcp.valor}::numeric - ${valorBusca}) <= 5`
      : or(ilike(pixRecebimentosMcp.pagadorNome, `%${q}%`), ilike(pixRecebimentosMcp.descricao, `%${q}%`))
  return pixLivresDoGrupo(grupo.id, filtro)
}

// Recusa volta como valor: em produção a mensagem de erro lançado não chega à tela (#404).
export async function vincularPixAlvoAction(pixId: string, alvo: AlvoConciliacao) {
  return acao(() => vincularPixAlvo(pixId, alvo))
}
async function vincularPixAlvo(pixId: string, alvo: AlvoConciliacao) {
  const usuario = await exigirAlvoNoGrupoAtivo(alvo)
  const grupo = await getGrupoAtivo(usuario)

  // `tipoCorrespondencia` usa 'venda' pra moto — é o enum que /pix-mcp já grava.
  const vinculo = alvo.tipo === 'peca' ? { tipo: 'peca' as const, pecaVendaId: alvo.id }
    : alvo.tipo === 'os'               ? { tipo: 'os' as const, osId: alvo.id }
    :                                    { tipo: 'venda' as const, vendaId: alvo.id }
  await vincularPix(pixId, grupo.id, vinculo, usuario.id)

  revalidarTelasDaConciliacao(alvo)
}

export async function desvincularPixAlvoAction(pixId: string) {
  return acao(() => desvincularPixAlvo(pixId))
}
async function desvincularPixAlvo(pixId: string) {
  const usuario = await getUsuarioLogado()
  if (!podeGerirConciliacao(usuario.papel)) throw new RecusaUsuario('Sem permissão')
  const grupo = await getGrupoAtivo(usuario)
  await desvincularPix(pixId, grupo.id)
  revalidarTelasDaConciliacao()
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


async function alvoParaEdicao(alvo: AlvoConciliacao) {
  const usuario = await exigirAlvoNoGrupoAtivo(alvo)
  const lojaIdsGrupo = await listarLojaIdsDoGrupoAtivo(usuario)
  const pgtos = await pagamentosDoAlvo(alvo, lojaIdsGrupo)
  if (!pgtos) throw alvoNaoEncontrado(alvo.tipo)
  return { usuario, lojaIdsGrupo, pgtos }
}

async function gravarPagamentos(alvo: AlvoConciliacao, lojaIdsGrupo: string[], pgtos: PgtoOS[]) {
  await gravarPagamentosDoAlvo(alvo, lojaIdsGrupo, pgtos)
  revalidarTelasDaConciliacao(alvo)
}

// Recusa volta como valor: em produção a mensagem de erro lançado não chega à tela (#404).
/** `valorRecebido`: na forçada de PIX, o que entrou na conta (#92); é o único valor em reais que vem da tela. */
export async function forcarConciliacaoAction(alvo: AlvoConciliacao, idx: number, motivo: string, valorRecebido?: number) {
  return acao(() => forcarConciliacao(alvo, idx, motivo, valorRecebido))
}
async function forcarConciliacao(alvo: AlvoConciliacao, idx: number, motivo: string, valorRecebido: unknown) {
  const usuario = await exigirAlvoNoGrupoAtivo(alvo)
  const lojaIdsGrupo = await listarLojaIdsDoGrupoAtivo(usuario)
  // Numa transação com a linha do alvo travada: o desvincular de um PIX deste alvo espera (pix-vinculo.ts).
  await db.transaction(async tx => {
    const pgtos = await pagamentosDoAlvo(alvo, lojaIdsGrupo, tx, true)
    if (!pgtos) throw alvoNaoEncontrado(alvo.tipo)
    // Quanto os lançamentos do alvo já cobrem do pagamento, pela mesma conta do painel: o PIX parcial força o que falta.
    const coberto = matchPagamentos(pgtos, await cartoesDoAlvo(alvo, tx), await pixDoAlvo(alvo, tx))[idx]?.coberto ?? 0
    const r = comForcado(pgtos, idx, motivo, { porId: usuario.id, porNome: usuario.nome, em: new Date().toISOString() }, { valorRecebido, coberto })
    if (!r.ok) throw new RecusaUsuario(r.erro)
    await gravarPagamentosDoAlvo(alvo, lojaIdsGrupo, r.dados, tx)
  })
  revalidarTelasDaConciliacao(alvo)
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
      // Cliente de outra Conta ligado à OS não empresta o nome, nem para a busca (#128).
      .leftJoin(clientes, and(eq(ordensServico.clienteId, clientes.id), eq(clientes.contaId, grupo.contaId)))
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
  const { contaId } = await getGrupoAtivo(usuario)

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
      .leftJoin(clientes, and(eq(ordensServico.clienteId, clientes.id), eq(clientes.contaId, contaId)))
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
