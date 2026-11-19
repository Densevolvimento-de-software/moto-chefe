// Ligar e soltar um PIX recebido do seu alvo (venda, OS, pedido ou venda de peça). As duas telas que
// fazem isso, a conciliação da venda e a /pix-mcp, gravam por aqui: o PIX só no grupo dado, nunca por cima.
import { and, eq, isNull } from 'drizzle-orm'
import { custoDoPixVinculado } from './custo-pix'
import { custoPixTaxaDoGrupo } from './custo-pix-grupo'
import { db } from './db'
import { ordensServico, pixRecebimentosMcp, vendas, vendasPecas } from './db/schema'
import { temForcadaParcialDePix, type PgtoOS } from './conciliacao-status'
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

const COMPLETA_FORCADA = 'Este PIX completa um pagamento marcado como recebido. Desfaça a forçada antes de desvincular.'

// Pagamentos do alvo a que o PIX está ligado (venda, OS ou venda de peça); pedido não tem forçada.
async function pagamentosDoVinculo(v: { vendaId: string | null; osId: string | null; pecaVendaId: string | null }): Promise<PgtoOS[]> {
  const [r] = v.vendaId ? await db.select({ p: vendas.pagamentos }).from(vendas).where(eq(vendas.id, v.vendaId))
    : v.osId ? await db.select({ p: ordensServico.pagamentos }).from(ordensServico).where(eq(ordensServico.id, v.osId))
    : v.pecaVendaId ? await db.select({ p: vendasPecas.pagamentos }).from(vendasPecas).where(eq(vendasPecas.id, v.pecaVendaId))
    : []
  return (r?.p ?? []) as PgtoOS[]
}

export async function desvincularPix(pixId: string, grupoId: string): Promise<void> {
  const [vinculo] = ehUuid(pixId)
    ? await db.select({ vendaId: pixRecebimentosMcp.vendaId, osId: pixRecebimentosMcp.osId, pecaVendaId: pixRecebimentosMcp.pecaVendaId })
      .from(pixRecebimentosMcp).where(doGrupo(pixId, grupoId)).limit(1)
    : []
  if (!vinculo) throw new RecusaUsuario(PIX_NAO_ENCONTRADO)
  if (temForcadaParcialDePix(await pagamentosDoVinculo(vinculo))) throw new RecusaUsuario(COMPLETA_FORCADA)

  const soltos = await db.update(pixRecebimentosMcp)
    .set(PIX_SOLTO)
    .where(doGrupo(pixId, grupoId))
    .returning({ id: pixRecebimentosMcp.id })
  if (soltos.length === 0) throw new RecusaUsuario(PIX_NAO_ENCONTRADO)
}
