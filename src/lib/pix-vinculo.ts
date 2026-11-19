// Ligar e soltar um PIX recebido do seu alvo (venda, OS, pedido ou venda de peça). As duas telas que
// fazem isso, a conciliação da venda e a /pix-mcp, gravam por aqui: o PIX só no grupo dado, nunca por cima.
import { and, eq, isNull } from 'drizzle-orm'
import { custoDoPixVinculado } from './custo-pix'
import { custoPixTaxaDoGrupo } from './custo-pix-grupo'
import { db } from './db'
import { pixRecebimentosMcp } from './db/schema'
import { COMPLETA_FORCADA, pixCompletaForcadaParcial } from './conciliacao-status'
import { cartoesDoAlvo, pagamentosDoAlvo, pixDoAlvo } from './alvo-da-conciliacao'
import type { AlvoConciliacao } from './conciliacao-alvo'
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

type Vinculo = { vendaId: string | null; osId: string | null; pecaVendaId: string | null }
const alvoDoVinculo = (v: Vinculo): AlvoConciliacao | null =>
  v.vendaId ? { tipo: 'moto', id: v.vendaId } : v.osId ? { tipo: 'os', id: v.osId } : v.pecaVendaId ? { tipo: 'peca', id: v.pecaVendaId } : null

// O alvo do PIX com os pagamentos lidos só nas lojas do grupo do PIX (pedido não tem forçada). Cartões e PIX
// do alvo só depois: eles leem pelo id.
async function alvoComPagamentos(v: Vinculo, grupoId: string) {
  const alvo = alvoDoVinculo(v)
  if (!alvo) return null
  const lojaIds = (await lojasDoGrupo(grupoId)).map(l => l.id)
  const pgtos = await pagamentosDoAlvo(alvo, lojaIds)
  if (!pgtos) return null
  return { pgtos, cartoes: await cartoesDoAlvo(alvo), pix: await pixDoAlvo(alvo) }
}

async function vinculoDoPix(pixId: string, grupoId: string): Promise<Vinculo | null> {
  const [v] = ehUuid(pixId)
    ? await db.select({ vendaId: pixRecebimentosMcp.vendaId, osId: pixRecebimentosMcp.osId, pecaVendaId: pixRecebimentosMcp.pecaVendaId })
      .from(pixRecebimentosMcp).where(doGrupo(pixId, grupoId)).limit(1)
    : []
  return v ?? null
}

/** Sem este PIX a forçada parcial do alvo fica sem o resto que a completava? */
async function completaForcada(pixId: string, grupoId: string, v: Vinculo): Promise<boolean> {
  const alvo = await alvoComPagamentos(v, grupoId)
  return alvo ? pixCompletaForcadaParcial(alvo.pgtos, alvo.cartoes, alvo.pix, pixId) : false
}

// `fraseSeCompleta`: a recusa quando o PIX completa uma forçada parcial; a action escolhe pelo papel.
export async function desvincularPix(pixId: string, grupoId: string, fraseSeCompleta = COMPLETA_FORCADA): Promise<void> {
  const vinculo = await vinculoDoPix(pixId, grupoId)
  if (!vinculo) throw new RecusaUsuario(PIX_NAO_ENCONTRADO)
  if (await completaForcada(pixId, grupoId, vinculo)) throw new RecusaUsuario(fraseSeCompleta)

  const soltos = await db.update(pixRecebimentosMcp)
    .set(PIX_SOLTO)
    .where(doGrupo(pixId, grupoId))
    .returning({ id: pixRecebimentosMcp.id })
  if (soltos.length === 0) throw new RecusaUsuario(PIX_NAO_ENCONTRADO)
}
