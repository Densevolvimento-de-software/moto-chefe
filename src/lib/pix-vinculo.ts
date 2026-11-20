// Ligar e soltar um PIX recebido do seu alvo (venda, OS, pedido ou venda de peça). As duas telas que
// fazem isso, a conciliação da venda e a /pix-mcp, gravam por aqui: o PIX só no grupo dado, nunca por cima.
import { and, eq, isNull } from 'drizzle-orm'
import { custoDoPixVinculado } from './custo-pix'
import { custoPixTaxaDoGrupo } from './custo-pix-grupo'
import { db } from './db'
import { pixRecebimentosMcp } from './db/schema'
import { COMPLETA_FORCADA, pixCompletaForcadaParcial, resumoDaForcadaQueOPixCompleta, semForcadasQueOPixCompleta, type ForcadaQueOPixCompleta } from './conciliacao-status'
import { cartoesDoAlvo, gravarPagamentosDoAlvo, pagamentosDoAlvo, pixDoAlvo, type ExecutorDoAlvo } from './alvo-da-conciliacao'
import { alvoDasColunas, type Alvos, type AlvoConciliacao } from './conciliacao-alvo'
import { lojasDoGrupo } from './conta'
import { ehTransferenciaInterna } from './pix-internos'
import { RecusaUsuario } from './resultado-action'
import { ehUuid } from './uuid'
import { PIX_SOLTO } from './pix-solto'

const PIX_NAO_ENCONTRADO = 'PIX não encontrado no grupo ativo'
// Decisão do Luis (18/11/2026): trocar o vínculo é desvincular e vincular de novo.
const PIX_JA_VINCULADO = 'Este PIX já está vinculado. Desvincule antes de vincular de novo.'
const PIX_INTERNO = 'Essa transferência é interna (maquininha/conta do próprio grupo) e não pode ser conciliada com uma venda'

/** Um alvo só: os outros ids ficam nulos. */
export type VinculoPix =
  | { tipo: 'venda'; vendaId: string }
  | { tipo: 'os'; osId: string }
  | { tipo: 'pedido'; pedidoId: string }
  | { tipo: 'peca'; pecaVendaId: string }

const doGrupo = (pixId: string, grupoId: string) => and(eq(pixRecebimentosMcp.id, pixId), eq(pixRecebimentosMcp.grupoId, grupoId))

export async function vincularPix(pixId: string, grupoId: string, vinculo: VinculoPix, porId: string): Promise<void> {
  const [pix] = ehUuid(pixId)
    ? await db.select({ pagadorNome: pixRecebimentosMcp.pagadorNome, tipo: pixRecebimentosMcp.tipoCorrespondencia, valor: pixRecebimentosMcp.valor, tipoOperacao: pixRecebimentosMcp.tipoOperacao })
      .from(pixRecebimentosMcp).where(doGrupo(pixId, grupoId)).limit(1)
    : []
  if (!pix) throw new RecusaUsuario(PIX_NAO_ENCONTRADO)
  if (pix.tipo) throw new RecusaUsuario(PIX_JA_VINCULADO)
  if (ehTransferenciaInterna(pix.pagadorNome)) throw new RecusaUsuario(PIX_INTERNO)

  // A taxa é a do grupo do PIX agora; o que se grava não muda se ela mudar depois.
  const custo = custoDoPixVinculado(pix.tipoOperacao, Number(pix.valor), await custoPixTaxaDoGrupo(grupoId))
  const ligados = await db.update(pixRecebimentosMcp)
    .set({
      tipoCorrespondencia: vinculo.tipo,
      vendaId:      vinculo.tipo === 'venda'  ? vinculo.vendaId     : null,
      osId:         vinculo.tipo === 'os'     ? vinculo.osId        : null,
      pedidoId:     vinculo.tipo === 'pedido' ? vinculo.pedidoId    : null,
      pecaVendaId:  vinculo.tipo === 'peca'   ? vinculo.pecaVendaId : null,
      lancadoPorId: porId,
      lancadoEm:    new Date(),
      valorBruto:   String(custo.valorBruto),
      custoPix:     String(custo.custoPix),
      custoPixTaxa: String(custo.custoPixTaxa),
    })
    .where(and(doGrupo(pixId, grupoId), isNull(pixRecebimentosMcp.tipoCorrespondencia)))
    .returning({ id: pixRecebimentosMcp.id })
  // Outro clique ligou o PIX entre a leitura e a gravação.
  if (ligados.length === 0) throw new RecusaUsuario(PIX_JA_VINCULADO)
}

// O alvo do PIX com os pagamentos lidos (e a linha travada) só nas lojas do grupo do PIX (pedido não tem forçada).
// Cartões e PIX do alvo só depois: eles leem pelo id.
async function alvoComPagamentos(v: Alvos, lojaIds: string[], tx: ExecutorDoAlvo) {
  const alvo = alvoDasColunas(v)
  if (!alvo) return null
  const pgtos = await pagamentosDoAlvo(alvo, lojaIds, tx, true)
  if (!pgtos) return null
  return { pgtos, cartoes: await cartoesDoAlvo(alvo, tx), pix: await pixDoAlvo(alvo, tx) }
}

async function vinculoDoPix(pixId: string, grupoId: string, tx: ExecutorDoAlvo): Promise<Alvos | null> {
  const [v] = ehUuid(pixId)
    ? await tx.select({ vendaId: pixRecebimentosMcp.vendaId, osId: pixRecebimentosMcp.osId, pecaVendaId: pixRecebimentosMcp.pecaVendaId })
      .from(pixRecebimentosMcp).where(doGrupo(pixId, grupoId)).limit(1)
    : []
  return v ?? null
}

/** Sem este PIX a forçada parcial do alvo fica sem o resto que a completava? */
async function completaForcada(pixId: string, lojaIds: string[], v: Alvos, tx: ExecutorDoAlvo): Promise<boolean> {
  const alvo = await alvoComPagamentos(v, lojaIds, tx)
  return alvo ? pixCompletaForcadaParcial(alvo.pgtos, alvo.cartoes, alvo.pix, pixId) : false
}

// `fraseSeCompleta`: a recusa quando o PIX completa uma forçada parcial; a action escolhe pelo papel. Confere e
// solta numa transação com a linha do alvo travada: dois desvincular, ou forçar e desvincular, no mesmo alvo não
// conferem ao mesmo tempo (cada um veria o PIX do outro e a forçada ficaria sem o dinheiro).
export async function desvincularPix(pixId: string, grupoId: string, fraseSeCompleta = COMPLETA_FORCADA): Promise<void> {
  // As lojas antes: dentro da transação, o db pegaria uma 2ª conexão do pool.
  const lojaIds = (await lojasDoGrupo(grupoId)).map(l => l.id)
  await db.transaction(async tx => {
    const vinculo = await vinculoDoPix(pixId, grupoId, tx)
    if (!vinculo) throw new RecusaUsuario(PIX_NAO_ENCONTRADO)
    if (await completaForcada(pixId, lojaIds, vinculo, tx)) throw new RecusaUsuario(fraseSeCompleta)

    await soltarPix(pixId, grupoId, tx)
  })
}

async function soltarPix(pixId: string, grupoId: string, tx: ExecutorDoAlvo) {
  const soltos = await tx.update(pixRecebimentosMcp)
    .set(PIX_SOLTO)
    .where(doGrupo(pixId, grupoId))
    .returning({ id: pixRecebimentosMcp.id })
  if (soltos.length === 0) throw new RecusaUsuario(PIX_NAO_ENCONTRADO)
}

/**
 * Desfaz só as forçadas parciais de PIX que este PIX completa (a função pura decide, nunca a tela) e solta o PIX, na
 * mesma transação e com a mesma trava do alvo do desvincular. Devolve o alvo, para revalidar as telas dele. Quem
 * pode (quem gere a conciliação) a action confere.
 */
export async function desfazerForcadaEDesvincularPix(pixId: string, grupoId: string): Promise<AlvoConciliacao | null> {
  const lojaIds = (await lojasDoGrupo(grupoId)).map(l => l.id)
  return db.transaction(async tx => {
    const vinculo = await vinculoDoPix(pixId, grupoId, tx)
    if (!vinculo) throw new RecusaUsuario(PIX_NAO_ENCONTRADO)
    const alvo = alvoDasColunas(vinculo)
    const doAlvo = await alvoComPagamentos(vinculo, lojaIds, tx)
    if (alvo && doAlvo) {
      const semForcadas = semForcadasQueOPixCompleta(doAlvo.pgtos, doAlvo.cartoes, doAlvo.pix, pixId)
      if (semForcadas !== doAlvo.pgtos) await gravarPagamentosDoAlvo(alvo, lojaIds, semForcadas, tx)
    }
    await soltarPix(pixId, grupoId, tx)
    return alvo
  })
}

/**
 * O que a caixa da /pix-mcp mostra: as forçadas parciais que este PIX completa, lidas com o PIX e os pagamentos no
 * grupo dado. PIX de outra Conta, inexistente ou que não completa nada: null, igual.
 */
export async function forcadaQueOPixCompleta(pixId: string, grupoId: string): Promise<ForcadaQueOPixCompleta | null> {
  const vinculo = await vinculoDoPix(pixId, grupoId, db)
  if (!vinculo) return null
  const doAlvo = await alvoComPagamentos(vinculo, (await lojasDoGrupo(grupoId)).map(l => l.id), db)
  return doAlvo ? resumoDaForcadaQueOPixCompleta(doAlvo.pgtos, doAlvo.cartoes, doAlvo.pix, pixId) : null
}
