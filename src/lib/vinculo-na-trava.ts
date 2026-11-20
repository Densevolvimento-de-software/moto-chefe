// Soltar do alvo o dinheiro que o liga a ele (o PIX do banco ou a linha da conciliação de cartão, como a linha pix
// da maquininha Mercado Pago) com a linha do alvo travada: conferir a forçada parcial de PIX (#92, #166), desfazer
// e soltar na mesma transação. Um lugar só para os dois itens.
import { and, eq, isNull } from 'drizzle-orm'
import type { AnyPgColumn } from 'drizzle-orm/pg-core'
import { db } from './db'
import { conciliacoesCartao, pixRecebimentosMcp } from './db/schema'
import {
  COMPLETA_FORCADA, pixCompletaForcadaParcial, resumoDaForcadaQueOPixCompleta, semForcadasQueOPixCompleta, type ForcadaQueOPixCompleta,
} from './conciliacao-status'
import { cartoesDoAlvo, gravarPagamentosDoAlvo, pagamentosDoAlvo, pixDoAlvo, type ExecutorDoAlvo } from './alvo-da-conciliacao'
import { alvoDasColunas, semAlvos, type Alvos, type AlvoConciliacao } from './conciliacao-alvo'
import { cartaoNaoEstornado } from './cartao-status'
import { lojasDoGrupo } from './conta'
import { PIX_SOLTO } from './pix-solto'
import { RecusaUsuario } from './resultado-action'
import { ehUuid } from './uuid'

/** O que liga dinheiro a um alvo, já preso ao grupo: ler o vínculo e soltar. */
export type ItemDoAlvo = {
  id: string
  /** Recusa de item de outra Conta, inexistente ou que mudou de alvo: a mesma frase. */
  naoEncontrado: string
  ler: (tx: ExecutorDoAlvo) => Promise<Alvos | null>
  /** Solta só se o vínculo ainda é o lido; devolve quantas linhas soltou. */
  soltar: (tx: ExecutorDoAlvo, vinculo: Alvos) => Promise<number>
}

type ColunasDoVinculo = Record<keyof Alvos, AnyPgColumn>

// O vínculo lido no começo vai no where: religado a outro alvo enquanto este esperava a trava, o item não é solto
// do alvo novo sem conferir a forçada dele.
const mesmoVinculo = (t: ColunasDoVinculo, v: Alvos) =>
  and(...(['vendaId', 'osId', 'pecaVendaId'] as const).map(c => (v[c] ? eq(t[c], v[c]) : isNull(t[c]))))

export const PIX_NAO_ENCONTRADO = 'PIX não encontrado no grupo ativo'
const CONCILIACAO_NAO_ENCONTRADA = 'Conciliação não encontrada'

/** O PIX recebido do banco, no grupo. */
export function pixDoBanco(pixId: string, grupoId: string): ItemDoAlvo {
  const t = pixRecebimentosMcp
  const doGrupo = and(eq(t.id, pixId), eq(t.grupoId, grupoId))
  return {
    id: pixId,
    naoEncontrado: PIX_NAO_ENCONTRADO,
    ler: async tx => (ehUuid(pixId)
      ? (await tx.select({ vendaId: t.vendaId, osId: t.osId, pecaVendaId: t.pecaVendaId }).from(t).where(doGrupo).limit(1))[0] ?? null
      : null),
    soltar: async (tx, v) => (await tx.update(t).set(PIX_SOLTO).where(and(doGrupo, mesmoVinculo(t, v))).returning({ id: t.id })).length,
  }
}

/** A linha da conciliação de cartão, no grupo; estornada mantém o vínculo e recebe a frase de inexistente. */
export function linhaDoCartao(conciliacaoId: string, grupoId: string): ItemDoAlvo {
  const t = conciliacoesCartao
  const daLinha = and(eq(t.id, conciliacaoId), eq(t.grupoId, grupoId), cartaoNaoEstornado)
  return {
    id: conciliacaoId,
    naoEncontrado: CONCILIACAO_NAO_ENCONTRADA,
    ler: async tx => (ehUuid(conciliacaoId)
      ? (await tx.select({ vendaId: t.vendaId, osId: t.osId, pecaVendaId: t.pecaVendaId }).from(t).where(daLinha).limit(1))[0] ?? null
      : null),
    soltar: async (tx, v) => (await tx.update(t).set({ ...semAlvos(), conciliado: false, conciliadoEm: null })
      .where(and(daLinha, mesmoVinculo(t, v))).returning({ id: t.id })).length,
  }
}

// O alvo do item com os pagamentos lidos (e a linha travada, se pedido) só nas lojas do grupo (pedido não tem forçada).
// Cartões e PIX do alvo só depois: eles leem pelo id.
async function alvoComPagamentos(v: Alvos, lojaIds: string[], tx: ExecutorDoAlvo, travar = true) {
  const alvo = alvoDasColunas(v)
  if (!alvo) return null
  const pgtos = await pagamentosDoAlvo(alvo, lojaIds, tx, travar)
  if (!pgtos) return null
  return { pgtos, cartoes: await cartoesDoAlvo(alvo, tx), pix: await pixDoAlvo(alvo, tx) }
}

/**
 * Lê o vínculo do item, roda `antes` e solta, tudo numa transação: quem lê os pagamentos do alvo dentro dela
 * (alvoComPagamentos) trava a linha dele até o fim. Devolve o alvo, para revalidar as telas dele.
 */
async function soltarNaTravaDoAlvo(item: ItemDoAlvo, grupoId: string,
  antes: (tx: ExecutorDoAlvo, vinculo: Alvos, lojaIds: string[]) => Promise<void>): Promise<AlvoConciliacao | null> {
  // As lojas antes: dentro da transação, o db pegaria uma 2ª conexão do pool.
  const lojaIds = (await lojasDoGrupo(grupoId)).map(l => l.id)
  return db.transaction(async tx => {
    const vinculo = await item.ler(tx)
    if (!vinculo) throw new RecusaUsuario(item.naoEncontrado)
    await antes(tx, vinculo, lojaIds)
    if (await item.soltar(tx, vinculo) === 0) throw new RecusaUsuario(item.naoEncontrado)
    return alvoDasColunas(vinculo)
  })
}

// `fraseSeCompleta`: a recusa quando o item completa uma forçada parcial; a action escolhe pelo papel. Dois desvincular,
// ou forçar e desvincular, no mesmo alvo não conferem ao mesmo tempo (cada um veria o item do outro e a forçada
// ficaria sem o dinheiro).
export function desvincularNaTrava(item: ItemDoAlvo, grupoId: string, fraseSeCompleta = COMPLETA_FORCADA) {
  return soltarNaTravaDoAlvo(item, grupoId, async (tx, vinculo, lojaIds) => {
    const doAlvo = await alvoComPagamentos(vinculo, lojaIds, tx)
    if (doAlvo && pixCompletaForcadaParcial(doAlvo.pgtos, doAlvo.cartoes, doAlvo.pix, item.id)) throw new RecusaUsuario(fraseSeCompleta)
  })
}

/**
 * Desfaz só as forçadas parciais de PIX que este item completa (a função pura decide, nunca a tela) e solta o item, na
 * mesma transação e com a mesma trava do alvo do desvincular. Quem pode (quem gere a conciliação) a action confere.
 */
export function desfazerForcadaEDesvincular(item: ItemDoAlvo, grupoId: string) {
  return soltarNaTravaDoAlvo(item, grupoId, async (tx, vinculo, lojaIds) => {
    const alvo = alvoDasColunas(vinculo)
    const doAlvo = await alvoComPagamentos(vinculo, lojaIds, tx)
    if (!alvo || !doAlvo) return
    const semForcadas = semForcadasQueOPixCompleta(doAlvo.pgtos, doAlvo.cartoes, doAlvo.pix, item.id)
    if (semForcadas !== doAlvo.pgtos) await gravarPagamentosDoAlvo(alvo, lojaIds, semForcadas, tx)
  })
}

/**
 * O que a tela mostra: as forçadas parciais que este item completa, lidas no grupo dado. Item de outra Conta,
 * inexistente ou que não completa nada: null, igual.
 */
export async function forcadaQueOItemCompleta(item: ItemDoAlvo, grupoId: string): Promise<ForcadaQueOPixCompleta | null> {
  const vinculo = await item.ler(db)
  if (!vinculo) return null
  // Só leitura para a tela: sem trava.
  const doAlvo = await alvoComPagamentos(vinculo, (await lojasDoGrupo(grupoId)).map(l => l.id), db, false)
  return doAlvo ? resumoDaForcadaQueOPixCompleta(doAlvo.pgtos, doAlvo.cartoes, doAlvo.pix, item.id) : null
}
