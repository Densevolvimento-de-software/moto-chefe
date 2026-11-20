import type { ResultadoAction } from '@/lib/resultado-action'
import { LINHA_PIX } from './conciliacao-cartao'
import { VALOR_RECEBIDO_INVALIDO, custoDoPixForcado, lerValorRecebido, type CustoDoPix } from './custo-pix'
import { centavos } from './centavos'
export type StatusConc = 'na' | 'pendente' | 'parcial' | 'conciliada'

export const TIPOS_CARTAO = new Set(['cartao_credito', 'cartao_debito', 'link_pagamento'])
export const PAGAMENTO_PIX: ReadonlySet<string> = new Set(['pix'])

/**
 * Tipos de pagamento da venda que uma linha da conciliação de cartão pode cobrir. A linha 'pix' só
 * existe para o Pix da maquininha Mercado Pago (#51) e cobre o pagamento Pix; as outras, cartão.
 */
export function tiposDoPagamentoDaLinha(tipoLinha: string | undefined): ReadonlySet<string> {
  return tipoLinha === LINHA_PIX ? PAGAMENTO_PIX : TIPOS_CARTAO
}

// Conciliação forçada na mão (quem pode: podeGerirConciliacao): o dinheiro entrou, mas não existe
// lançamento correspondente no sistema (relatório da operadora não importado, PIX
// fora do Open Finance, transferência avulsa). Fica gravada no próprio item do array
// `pagamentos` — ver docs/superpowers/specs/2026-07-31-forcar-conciliacao-design.md.
// `pix`: na forçada de um pagamento PIX feita depois da #92, o que entrou na conta e o custo, calculados por
// comForcado. Cartão, financiamento e as forçadas de PIX anteriores não têm.
export type PixDaForcada = { valorRecebido: number } & CustoDoPix
export type ConciliadoManual = { motivo: string; porId: string; porNome: string; em: string; pix?: PixDaForcada }

export type PgtoOS = {
  tipo: string
  valor: number
  operadora?: string
  parcelas?: number
  autorizacao?: string
  /** Código do cupom de revisão gratuita, quando `tipo` é 'cupom_revisao'.
   *  Ver src/lib/cupom-revisao.ts. */
  cupom?: string
  conciliadoManual?: ConciliadoManual | null
}

type PgtoItem = { tipo: string; valor: number; conciliadoManual?: ConciliadoManual | null }

/**
 * O pagamento precisa ser conferido contra dinheiro que entrou?
 *
 * Cartão e PIX têm origem automática (relatório da operadora, Open Finance).
 * FINANCIAMENTO não tem: o banco deposita e nada no sistema sabe disso, então ele
 * fica pendente até alguém confirmar na mão que caiu — decisão do Cesar em
 * 01/09/2026, que trocou a aprovação no momento da venda por essa conferência
 * depois. Quem força: podeGerirConciliacao (src/lib/conciliacao-papeis.ts).
 *
 * Dinheiro, cortesia, bonificação e cupom de revisão ficam de fora: não há
 * depósito a esperar, e cobrá-los criaria pendência que nunca fecha.
 */
export function precisaConciliar(tipo: string): boolean {
  return TIPOS_CARTAO.has(tipo) || PAGAMENTO_PIX.has(tipo) || tipo === 'financiamento'
}

// `idx` vem do navegador: só índice inteiro conta ("length" ou "0" em texto acharia outra coisa).
const pagamentoNo = (pgtos: readonly PgtoOS[], idx: number) => Number.isInteger(idx) ? pgtos[idx] : undefined

/** Quem força e quando: sai do servidor, nunca do navegador. */
export type AutorDoForcado = Pick<ConciliadoManual, 'porId' | 'porNome' | 'em'>

/**
 * Na forçada de PIX (#92): o que entrou na conta (vem da tela, ainda sem conferir) e quanto do pagamento os
 * lançamentos já cobrem (a forçada parte do que falta, decisão do Luis registrada na #92). A action lê a cobertura
 * no banco; a tela usa a do painel.
 */
export type RecebimentoDaForcada = { valorRecebido: unknown; coberto: number; baseVista?: unknown }

/** Recusa de desvincular o PIX que completa uma forçada parcial; quem gere desfaz pelo painel da venda ou pela /pix-mcp. */
export const COMPLETA_FORCADA = 'Este PIX completa um pagamento marcado como recebido. Desfaça a forçada antes de desvincular.'
// Para quem não gere a conciliação (não pode desfazer a forçada).
export const COMPLETA_FORCADA_PEDIR_A_GESTOR = 'Este PIX completa um pagamento marcado como recebido. Peça a quem gere a conciliação para desfazer a forçada.'

export const PAGAMENTO_JA_FORCADO = 'Este pagamento já foi marcado como recebido. Desfaça antes de marcar de novo.'
// A base que a tela mostrou não é a de agora: um PIX vinculou ou soltou entre abrir e confirmar (decisão do Luis registrada na #92).
export const LANCAMENTOS_MUDARAM = 'Os lançamentos deste pagamento mudaram. Confira e marque de novo.'
// O valor que veio da tela é número e bate com o do servidor em centavos.
const mesmosCentavos = (a: number, b: unknown) => typeof b === 'number' && Math.abs(a - b) < 0.005

/** Os pagamentos com o da posição `idx` marcado como recebido na mão, ou a frase da recusa. */
export function comForcado(
  pgtos: readonly PgtoOS[], idx: number, motivo: unknown, autor: AutorDoForcado, recebimento?: RecebimentoDaForcada,
): ResultadoAction<PgtoOS[]> {
  const texto = typeof motivo === 'string' ? motivo.trim() : ''
  if (texto.length < 3) return { ok: false, erro: 'Informe o motivo da conciliação forçada' }
  const alvo = pagamentoNo(pgtos, idx)
  if (!alvo) return { ok: false, erro: 'Pagamento não encontrado' }
  if (!precisaConciliar(alvo.tipo)) return { ok: false, erro: 'Esse pagamento não precisa de conciliação' }
  // Como no vínculo do PIX (#90): o que a marca gravou não muda calado.
  if (alvo.conciliadoManual) return { ok: false, erro: PAGAMENTO_JA_FORCADO }
  const autoria = { motivo: texto, porId: autor.porId, porNome: autor.porNome, em: autor.em }
  const pix = PAGAMENTO_PIX.has(alvo.tipo) ? pixDaForcada(alvo.valor, recebimento) : undefined
  if (typeof pix === 'string') return { ok: false, erro: pix }
  if (pix && !mesmosCentavos(pix.valorBruto, recebimento?.baseVista)) return { ok: false, erro: LANCAMENTOS_MUDARAM }
  const marca: ConciliadoManual = pix ? { ...autoria, pix } : autoria
  return { ok: true, dados: pgtos.map((p, i) => i === idx ? { ...p, conciliadoManual: marca } : p) }
}

/** De quanto parte a forçada de PIX: o que os lançamentos ainda não cobrem do pagamento. Tela e servidor. */
export const baseDaForcada = (valorDoPagamento: number, coberto: number) => centavos(valorDoPagamento - coberto)

/** A parte pix da marca, ou a frase da recusa. A tela usa a mesma conta para mostrar as colunas. */
export function pixDaForcada(valorDoPagamento: number, recebimento?: RecebimentoDaForcada): PixDaForcada | string {
  const valorRecebido = lerValorRecebido(recebimento?.valorRecebido)
  if (valorRecebido === null) return VALOR_RECEBIDO_INVALIDO
  const base = baseDaForcada(valorDoPagamento, recebimento?.coberto ?? 0)
  if (base <= 0) return 'Esse pagamento já está conciliado'
  return { valorRecebido, ...custoDoPixForcado(base, valorRecebido) }
}

/** Os pagamentos sem a marcação de forçado na posição `idx`, ou a frase da recusa. */
export function semForcado(pgtos: readonly PgtoOS[], idx: number): ResultadoAction<PgtoOS[]> {
  if (!pagamentoNo(pgtos, idx)) return { ok: false, erro: 'Pagamento não encontrado' }
  return {
    ok: true,
    dados: pgtos.map((p, i) => {
      if (i !== idx) return p
      const { conciliadoManual: _removido, ...resto } = p
      return resto
    }),
  }
}

// Total dos pagamentos marcados como conciliados na mão. Usado por
// calcStatusMultiPagamento e pelos dois pontos que fazem a conta em JS por fora
// (KPIs de /vendas e o calcStatus da tabela de vendas).
export function valorConciliadoManual(pagamentos: unknown): number {
  const pgtos = (pagamentos ?? []) as PgtoItem[]
  return pgtos
    .filter(p => p.conciliadoManual && precisaConciliar(p.tipo))
    // Forçada parcial de PIX (#92): a marca vale o que faltava; o resto da linha já conta como PIX vinculado.
    .reduce((a, p) => a + (Number(p.conciliadoManual?.pix?.valorBruto ?? p.valor) || 0), 0)
}

type ConcMatch = { id: string; autorizacao: string | null; valorBruto: string | number; tipo?: string; operadora?: string }
// `valorBruto`: o valor do PIX gravado ao vincular (#90); o `valor` é o que o banco creditou, já sem o custo.
// `operadora`: só a linha pix da maquininha (#51); o PIX do banco não tem.
type PixMatch  = { id: string; valor: string | number; valorBruto?: string | number | null; operadora?: string }
// O PIX cobre o pagamento pelo valor do PIX, como o cartão pelo valor bruto; sem ele gravado (vínculo antigo), pelo crédito.
// A mesma regra das somas em SQL está em pixCobertoSql (src/lib/queries/pix-coberto.ts).
const valorQueCobre = (r: PixMatch) => Number(r.valorBruto ?? r.valor)

/** Quanto do pagamento foi coberto por dinheiro que realmente entrou. */
// `pixId`: o PIX recebido do banco que cobriu a linha inteira (casou pelo valor); a tela mostra o custo dele (#90).
// Rateio e a linha pix do Mercado Pago (que vem da conciliação de cartão) não têm.
// `pixDaMaquininha`: a operadora, quando foi a linha pix da maquininha que cobriu o PIX (o painel diz de onde veio, #51).
export type CoberturaPgto = { conciliado: boolean; coberto: number; pixId?: string; pixDaMaquininha?: string }

// Vendas, peças e OS podem ter mais de uma forma de pagamento por cartão/pix no mesmo
// carrinho (ex.: Pix + Cartão). Casa cada item do array `pagamentos` com o que entrou,
// individualmente, para que cada forma possa ser conciliada de forma independente na UI.
//
// A linha só fecha quando o VALOR recebido cobre o valor lançado. Antes bastava existir
// a transação: um PIX de R$ 5.990 fechava um pagamento de R$ 10.990, e um cartão casado
// por autorização fechava mesmo vindo com valor menor. O resultado era a tela de
// detalhes toda verde enquanto o badge da listagem — que sempre comparou valores —
// dizia "Parcial". Quem manda é o valor; ver calcStatusMultiPagamento.
export function matchPagamentos(pgtos: PgtoOS[], linhasDoAlvo: ConcMatch[], pixDoBanco: PixMatch[]): CoberturaPgto[] {
  return cobrir(pgtos, linhasDoAlvo, pixDoBanco).resultado
}

// O que falta numa linha PIX forçada só em parte (#92): o valor menos o que a marca cobriu; 0 nas outras.
function restoDaForcadaParcial(p: PgtoOS): number {
  const base = PAGAMENTO_PIX.has(p.tipo) ? p.conciliadoManual?.pix?.valorBruto : undefined
  const resto = base === undefined ? 0 : p.valor - base
  return resto > 0.05 ? resto : 0
}

// `faltaNasForcadas`: quanto do resto das forçadas parciais de PIX (#92) os PIX vinculados não cobrem.
function cobrir(pgtos: PgtoOS[], linhasDoAlvo: ConcMatch[], pixDoBanco: PixMatch[]): { resultado: CoberturaPgto[]; faltaNasForcadas: number } {
  // A linha 'pix' da conciliação de cartão é o Pix da maquininha Mercado Pago (#51): é dinheiro de
  // Pix e cobre o pagamento Pix, como o recebimento do banco.
  const concs = linhasDoAlvo.filter(c => c.tipo !== LINHA_PIX)
  // `doBanco`: só o PIX recebido do banco tem custo e vira `pixId` na cobertura.
  const pixRecs: (PixMatch & { doBanco: boolean })[] = [
    ...pixDoBanco.map(r => ({ ...r, doBanco: true })),
    ...linhasDoAlvo.filter(c => c.tipo === LINHA_PIX).map(c => ({ id: c.id, valor: c.valorBruto, operadora: c.operadora, doBanco: false })),
  ]
  const usados    = new Set<string>()
  const resultado: CoberturaPgto[] = pgtos.map(() => ({ conciliado: false, coberto: 0 }))

  // Forçados entram antes dos laços automáticos: assim o match por valor (que pula
  // índices já resolvidos) não gasta uma transação real num pagamento que já foi
  // fechado na mão, deixando o irmão de mesmo valor pendente à toa.
  pgtos.forEach((p, i) => {
    if (p.conciliadoManual) resultado[i] = { conciliado: true, coberto: p.valor }
  })

  // Cartão pela autorização: é a transação certa, mesmo que o valor tenha vindo
  // diferente. Cobre o que a operadora reportou — a diferença fica visível na tela.
  pgtos.forEach((p, i) => {
    if (!TIPOS_CARTAO.has(p.tipo) || !p.autorizacao || resultado[i].conciliado) return
    const m = concs.find(c => !usados.has(c.id) && c.autorizacao === p.autorizacao)
    if (m) { resultado[i].coberto = Number(m.valorBruto); usados.add(m.id) }
  })

  pgtos.forEach((p, i) => {
    if (!TIPOS_CARTAO.has(p.tipo) || resultado[i].conciliado || resultado[i].coberto > 0) return
    const m = concs.find(c => !usados.has(c.id) && Math.abs(Number(c.valorBruto) - p.valor) <= 0.05)
    if (m) { resultado[i].coberto = Number(m.valorBruto); usados.add(m.id) }
  })

  // Transações vinculadas à venda que não casaram com nenhuma linha (ex.: uma cobrança
  // agregada para dois pagamentos) ainda são dinheiro que entrou — rateia no que falta,
  // senão a listagem diria "conciliada" com todas as linhas vermelhas.
  let sobraCartao = concs.filter(c => !usados.has(c.id)).reduce((a, c) => a + Number(c.valorBruto), 0)
  pgtos.forEach((p, i) => {
    if (!TIPOS_CARTAO.has(p.tipo) || resultado[i].conciliado || sobraCartao <= 0) return
    const falta = p.valor - resultado[i].coberto
    if (falta <= 0.05) return
    const usa = Math.min(falta, sobraCartao)
    resultado[i].coberto += usa
    sobraCartao -= usa
  })

  // PIX não tem autorização para casar, mas o valor identifica: quando o recebimento
  // bate com uma das linhas, é dela. Casa por valor primeiro — o rateio puro na ordem
  // pintava a linha errada na venda com PIX de 4.490 + 5.000 + 1.000 (NF 2284), onde os
  // recebimentos conciliados eram justamente os de 5.000 e 1.000.
  const pixUsados = new Set<string>()
  // Forçada parcial de PIX (#92): a marca cobre só o que faltava (pix.valorBruto); o resto da linha sai dos
  // PIX vinculados que sobram depois das outras linhas casarem pelo valor (reserva antes do rateio).
  const reservaPix = pgtos.reduce((a, p) => a + restoDaForcadaParcial(p), 0)
  pgtos.forEach((p, i) => {
    if (!PAGAMENTO_PIX.has(p.tipo) || resultado[i].conciliado) return
    const m = pixRecs.find(r => !pixUsados.has(r.id) && Math.abs(valorQueCobre(r) - p.valor) <= 0.05)
    if (!m) return
    resultado[i].coberto += valorQueCobre(m)
    if (m.doBanco) resultado[i].pixId = m.id
    if (m.operadora) resultado[i].pixDaMaquininha = m.operadora
    pixUsados.add(m.id)
  })

  // O que sobrou rateia entre as linhas PIX ainda descobertas, na ordem. Dois PIX
  // lançados e um só recebimento fecham um, não os dois.
  const sobra = pixRecs.filter(r => !pixUsados.has(r.id)).reduce((a, r) => a + (valorQueCobre(r) || 0), 0)
  let poolPix = Math.max(0, sobra - reservaPix)
  pgtos.forEach((p, i) => {
    if (!PAGAMENTO_PIX.has(p.tipo) || resultado[i].conciliado || poolPix <= 0) return
    const falta = p.valor - resultado[i].coberto
    if (falta <= 0.05) return
    const usa = Math.min(falta, poolPix)
    resultado[i].coberto += usa
    poolPix -= usa
  })

  resultado.forEach((r, i) => {
    if (r.conciliado) return
    r.conciliado = precisaConciliar(pgtos[i].tipo) && r.coberto >= pgtos[i].valor - 0.05
  })

  return { resultado, faltaNasForcadas: Math.max(0, reservaPix - sobra) }
}

// Vendas, peças e OS: pagamento pode ter múltiplos itens (carrinho com pix + cartão +
// dinheiro, etc.). Reaproveitada pelas três telas — não duplicar essa lógica.
export function calcStatusMultiPagamento(
  pagamentos: unknown,
  conciliadoValor: number,
  pixConciliadoValor: number,
  valorTotal: string,
): StatusConc {
  // Venda/OS/peça de valor zero (ex.: OS gratuita) não tem nada a conciliar,
  // independente da forma de pagamento lançada.
  if (Number(valorTotal) < 0.01) return 'conciliada'

  const pgtos = (pagamentos ?? []) as PgtoItem[]
  if (pgtos.length === 0) return 'na'

  const totalLancado = pgtos.reduce((a, p) => a + (Number(p.valor) || 0), 0)

  if (totalLancado < Number(valorTotal) - 0.05) return 'parcial'

  // Sai de precisaConciliar em vez de listar cartão e PIX aqui: sem isso,
  // financiamento entrou na regra de lá e continuou fora da conta daqui, e a venda
  // financiada aparecia conciliada com a linha vermelha na tela de detalhes.
  const totalNecessario = pgtos
    .filter(p => precisaConciliar(p.tipo))
    .reduce((a, p) => a + (Number(p.valor) || 0), 0)
  if (totalNecessario < 0.01) return 'conciliada' // só dinheiro/cortesia/bonificação

  const conciliado = (Number(conciliadoValor) || 0)
    + (Number(pixConciliadoValor) || 0)
    + valorConciliadoManual(pgtos)
  if (conciliado < 0.01) return 'pendente'
  if (conciliado >= totalNecessario - 0.05) return 'conciliada'
  return 'parcial'
}

const LABEL_PARA_TIPO_OS: Record<string, string> = {
  'PIX':                  'pix',
  'Dinheiro':             'dinheiro',
  'Cartão de Crédito':    'cartao_credito',
  'Cartão de Débito':     'cartao_debito',
  'Transferência':        'transferencia',
  'Cortesia / Garantia':  'cortesia',
  'Gratuita':             'gratuita',
}

// OS abertas antes do pagamento multi-forma só gravavam o array `pagamentos` quando a
// forma era cartão — PIX/Dinheiro/Transferência/Cortesia ficavam só em `formaPagamento`
// (texto). Sintetiza um array de 1 item nesses casos pra reaproveitar
// calcStatusMultiPagamento sem perder o histórico de conciliação dessas OS.
export function pagamentosEfetivosOS(
  formaPagamento: string | null,
  pagamentos: unknown,
  valorTotal: string | null,
): PgtoOS[] {
  const arr = (pagamentos ?? []) as PgtoOS[]
  if (arr.length > 0) return arr
  if (!formaPagamento) return []
  const tipo = LABEL_PARA_TIPO_OS[formaPagamento] ?? formaPagamento.toLowerCase()
  return [{ tipo, valor: Number(valorTotal) || 0 }]
}

/**
 * Sem este PIX, a forçada parcial de PIX do alvo (#92) fica sem o resto que a completava? Quem desvincula
 * recusa só nesse caso; PIX que cobre outra linha ou que sobra solta. `pixId`: o PIX do banco ou a linha da
 * conciliação de cartão (a linha pix da maquininha também completa a forçada, #166).
 */
export function pixCompletaForcadaParcial(pgtos: PgtoOS[], linhasDoAlvo: ConcMatch[], pixDoBanco: PixMatch[], pixId: string): boolean {
  const com = cobrir(pgtos, linhasDoAlvo, pixDoBanco).faltaNasForcadas
  const sem = cobrir(pgtos, linhasDoAlvo.filter(c => c.id !== pixId), pixDoBanco.filter(r => r.id !== pixId)).faltaNasForcadas
  return sem - com > 0.05
}

/** Linha da maquininha ligada ao alvo e estornada no Mercado Pago. */
export type EstornoDoAlvo = { id: string; valorBruto: string | number; tipo: string }

const estornoCobre = (p: PgtoOS, e: EstornoDoAlvo) =>
  tiposDoPagamentoDaLinha(e.tipo).has(p.tipo) && Math.abs(Number(e.valorBruto) - p.valor) <= 0.05

/**
 * Para cada pagamento, se um estorno no Mercado Pago o deixou pendente: pagamento ainda não conciliado com um estorno
 * ligado ao alvo do mesmo meio e valor. Cada estorno explica um pagamento só. Sem o dia: o importador não grava quando
 * estornou, e a data da linha é a da venda.
 */
export function estornosDosPagamentos(pgtos: PgtoOS[], cobertura: CoberturaPgto[], estornos: EstornoDoAlvo[]): boolean[] {
  return pgtos.reduce<{ marcados: boolean[]; usados: ReadonlySet<string> }>((acc, p, i) => {
    const e = cobertura[i]?.conciliado ? undefined : estornos.find(x => !acc.usados.has(x.id) && estornoCobre(p, x))
    return { marcados: [...acc.marcados, Boolean(e)], usados: e ? new Set([...acc.usados, e.id]) : acc.usados }
  }, { marcados: [], usados: new Set() }).marcados
}

const semAMarca = (pgtos: PgtoOS[], idx: number): PgtoOS[] => {
  const r = semForcado(pgtos, idx)
  return r.ok ? r.dados : pgtos
}

// Todos os subconjuntos não vazios; acima de 10 linhas forçadas em parte num mesmo alvo, só o conjunto inteiro.
const subconjuntos = (xs: number[]): number[][] =>
  xs.length > 10 ? [xs] : xs.reduce<number[][]>((acc, x) => [...acc, ...acc.map(s => [...s, x])], [[]]).filter(s => s.length > 0)

/**
 * As linhas forçadas só em parte cuja marca sai junto quando este PIX solta (#92). Serve o conjunto que, sem o PIX
 * e sem essas marcas, não deixa nenhuma forçada que fica com falta maior que a de hoje (critério que o bot do
 * #189 pediu: soltar o PIX nunca deixa marca sem o dinheiro). Entre os que servem, o de menor soma dos restos,
 * depois o de menos linhas: sai só o que basta. Vazio se o PIX não completa nenhuma.
 */
export function forcadasQueOPixCompleta(pgtos: PgtoOS[], linhasDoAlvo: ConcMatch[], pixDoBanco: PixMatch[], pixId: string): number[] {
  const hoje = cobrir(pgtos, linhasDoAlvo, pixDoBanco).faltaNasForcadas
  // `pixId`: o PIX do banco ou a linha pix da maquininha (#166); sai das duas listas.
  const semOPix = (ps: PgtoOS[]) => cobrir(ps, linhasDoAlvo.filter(c => c.id !== pixId), pixDoBanco.filter(r => r.id !== pixId)).faltaNasForcadas
  if (semOPix(pgtos) - hoje <= 0.05) return []
  const parciais = pgtos.flatMap((p, i) => (restoDaForcadaParcial(p) > 0 ? [i] : []))
  const restos = (s: number[]) => s.reduce((a, i) => a + restoDaForcadaParcial(pgtos[i]), 0)
  const servem = subconjuntos(parciais).filter(s => semOPix(s.reduce(semAMarca, pgtos)) - hoje <= 0.05)
  const melhor = [...servem].sort((x, y) => restos(x) - restos(y) || x.length - y.length)[0]
  return melhor ?? parciais
}

/** Os pagamentos sem as marcas de forcadasQueOPixCompleta; PIX que não completa nada devolve os mesmos pagamentos. */
export function semForcadasQueOPixCompleta(pgtos: PgtoOS[], linhasDoAlvo: ConcMatch[], pixDoBanco: PixMatch[], pixId: string): PgtoOS[] {
  const idx = forcadasQueOPixCompleta(pgtos, linhasDoAlvo, pixDoBanco, pixId)
  return idx.length ? idx.reduce(semAMarca, pgtos) : pgtos
}

/** O que a caixa da /pix-mcp mostra das forçadas parciais que um PIX completa (#92). */
export type ForcadaQueOPixCompleta = { linhas: { valor: number; marcado: number }[]; cobre: number }

/** Cada pagamento cuja marca sai junto com este PIX e quanto foi marcado; `cobre`: o que ESTE PIX cobre dos restos. */
export function resumoDaForcadaQueOPixCompleta(pgtos: PgtoOS[], linhasDoAlvo: ConcMatch[], pixDoBanco: PixMatch[], pixId: string): ForcadaQueOPixCompleta | null {
  const idx = forcadasQueOPixCompleta(pgtos, linhasDoAlvo, pixDoBanco, pixId)
  if (idx.length === 0) return null
  const oPix = pixDoBanco.find(r => r.id === pixId)
  const aLinha = linhasDoAlvo.find(c => c.id === pixId)
  const valorDele = oPix ? valorQueCobre(oPix) : aLinha ? Number(aLinha.valorBruto) : Infinity
  const restos = idx.reduce((a, i) => a + restoDaForcadaParcial(pgtos[i]), 0)
  return {
    linhas: idx.map(i => ({ valor: pgtos[i].valor, marcado: centavos(pgtos[i].valor - restoDaForcadaParcial(pgtos[i])) })),
    cobre: centavos(Math.min(restos, valorDele)),
  }
}

// O resumo que a caixa mostrou só confere (#92, decisão do Luis registrada na #92): o servidor recalcula sob a trava e
// recusa se difere. Nunca entra no cálculo.
export const RESUMO_DA_FORCADA_MUDOU = 'Os lançamentos deste pagamento mudaram. Confira e tente de novo.'
export function mesmoResumoDaForcada(agora: ForcadaQueOPixCompleta | null, visto: unknown): boolean {
  if (agora === null) return visto === null
  if (typeof visto !== 'object' || visto === null) return false
  const { linhas, cobre } = visto as Record<string, unknown>
  if (!Array.isArray(linhas) || linhas.length !== agora.linhas.length || !mesmosCentavos(agora.cobre, cobre)) return false
  return agora.linhas.every((l, i) => {
    const v = linhas[i] as Record<string, unknown> | null
    return typeof v === 'object' && v !== null && mesmosCentavos(l.valor, v.valor) && mesmosCentavos(l.marcado, v.marcado)
  })
}
