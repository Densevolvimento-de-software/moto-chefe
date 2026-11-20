// Ligar e soltar um PIX recebido do seu alvo (venda, OS, pedido ou venda de peça). As duas telas que
// fazem isso, a conciliação da venda e a /pix-mcp, gravam por aqui: o PIX só no grupo dado, nunca por cima.
import { and, eq, isNull } from 'drizzle-orm'
import { custoDoPixVinculado } from './custo-pix'
import { custoPixTaxaDoGrupo } from './custo-pix-grupo'
import { db } from './db'
import { pixRecebimentosMcp } from './db/schema'
import { COMPLETA_FORCADA, type ForcadaQueOPixCompleta } from './conciliacao-status'
import type { AlvoConciliacao } from './conciliacao-alvo'
import { ehTransferenciaInterna } from './pix-internos'
import { RecusaUsuario } from './resultado-action'
import { ehUuid } from './uuid'
import { desfazerForcadaEDesvincular, desvincularNaTrava, forcadaQueOItemCompleta, PIX_NAO_ENCONTRADO, pixDoBanco } from './vinculo-na-trava'

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

/** Desvincula o PIX do banco com a forçada parcial conferida na trava do alvo (vinculo-na-trava). */
export async function desvincularPix(pixId: string, grupoId: string, fraseSeCompleta = COMPLETA_FORCADA): Promise<void> {
  await desvincularNaTrava(pixDoBanco(pixId, grupoId), grupoId, fraseSeCompleta)
}

/** Desfaz as forçadas parciais que este PIX completa e o solta (B2 da #92). Devolve o alvo, para revalidar as telas. */
export const desfazerForcadaEDesvincularPix = (pixId: string, grupoId: string, resumoVisto: unknown): Promise<AlvoConciliacao | null> =>
  desfazerForcadaEDesvincular(pixDoBanco(pixId, grupoId), grupoId, resumoVisto)

/** O que a caixa da /pix-mcp mostra das forçadas parciais que este PIX completa; null se nenhuma (ou outra Conta). */
export const forcadaQueOPixCompleta = (pixId: string, grupoId: string): Promise<ForcadaQueOPixCompleta | null> =>
  forcadaQueOItemCompleta(pixDoBanco(pixId, grupoId), grupoId)
