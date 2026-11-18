/**
 * Regras do Editar do pedido efetivado (#23, Q17): o pedido é editado inteiro, e com NF valendo o que está na nota
 * (cliente e valores) não muda; o pagamento, sim (decisão do Luis, ponto 1 do #25).
 */
import { soDigitosDoc } from '@/lib/documento'
import { travaDoCancelamentoDaVenda } from '@/lib/notagateway/status'
import { travaDoPapel } from '@/lib/cancelar-venda'
import type { CompradorVenda } from '@/lib/venda-comprador'
import { valorDePecaInvalido } from '@/lib/pedido-venda-regras'

/** Os campos do comprador que o formulário manda: o servidor só lê estes (#891). */
export const CAMPOS_DO_COMPRADOR = [
  'clienteNome', 'clienteCpf', 'clienteCelular', 'clienteEmail', 'clienteCep', 'clienteLogradouro', 'clienteNumero',
  'clienteComplemento', 'clienteBairro', 'clienteCidade', 'clienteEstado', 'representanteNome', 'representanteCpf',
  'clienteIndicadorIe', 'clienteInscricaoEstadual',
] as const satisfies readonly (keyof CompradorVenda)[]

type NotaDaTrava = { ambiente: string; status: string; dataAutorizacao: string | null; numero: string | null }

/** Por que cliente e valores travam: a NF do MOVA valendo, ou o nº de NF preenchido para o aux_adm (#191). */
export type TravaDoPedido = { numero: string | null; por: 'nota' | 'papel' }

/**
 * A NF que trava o pedido: a mesma regra do "Cancelar venda" (ADR-0014, `travaDoCancelamentoDaVenda`) e, para o aux_adm, o
 * nº de NF preenchido (#191), em qualquer venda do pedido. null se nada trava.
 */
export function nfQueTravaOPedido(
  vendas: readonly { notas: readonly NotaDaTrava[]; notaFiscalSaida: string | null }[], papel: string, agora: Date,
): TravaDoPedido | null {
  const daNota = vendas.map(v => travaDoCancelamentoDaVenda([...v.notas], agora)).find(r => r !== null)
  if (daNota) return { numero: daNota.nota.numero, por: 'nota' }
  const doPapel = vendas.find(v => travaDoPapel(papel, v.notaFiscalSaida))
  return doPapel ? { numero: doPapel.notaFiscalSaida, por: 'papel' } : null
}

const doCampo = (k: (typeof CAMPOS_DO_COMPRADOR)[number], v: string | null | undefined) =>
  (k === 'clienteCpf' || k === 'representanteCpf' ? soDigitosDoc(v) : (v ?? '').trim())

/** O cliente mandado difere do gravado. Campo ausente não muda nada (como na gravação); vazio vale nulo. */
export function clienteMudou(gravado: Partial<Record<keyof CompradorVenda, string | null>>, novo: CompradorVenda): boolean {
  return CAMPOS_DO_COMPRADOR.some(k => novo[k] !== undefined && doCampo(k, novo[k]) !== doCampo(k, gravado[k]))
}

/** Algum item tem valor diferente do gravado (meio centavo de tolerância, a do `travaDoValorVenda`). */
export function algumValorMudou(gravados: ReadonlyMap<string, number>, novos: readonly { chave: string; valor: number }[]): boolean {
  return novos.some(n => !gravados.has(n.chave) || Math.abs(gravados.get(n.chave)! - n.valor) >= 0.005)
}

/** A recusa quando a NF trava e o cliente ou um valor mudou; null se pode gravar. */
// Pelo nº de NF (#191) quem decide é o papel, não a nota: cancelar a nota não é o caminho do aux_adm.
const fraseDoPapel = (numero: string | null) => `Esta venda tem NF registrada (nº ${numero}). Cliente e valores só mudam com os administradores. Dá para corrigir o pagamento.`
const fraseDaNota = (numero: string | null) =>
  `${numero ? `A nota fiscal nº ${numero}` : 'A nota fiscal do pedido'} está valendo. Itens, valores e cliente estão nela e não mudam. Para mudar, cancele a nota antes.`

export function recusaDaEdicaoNaNota(trava: TravaDoPedido | null, clienteOuValorMudou: boolean): string | null {
  if (!trava || !clienteOuValorMudou) return null
  return trava.por === 'papel' ? fraseDoPapel(trava.numero) : fraseDaNota(trava.numero)
}

/** O aviso do Editar pedido efetivado (25d) quando a NF trava: a mesma frase da recusa, e o que ainda dá para mudar. */
export const avisoDaTrava = (trava: TravaDoPedido): string =>
  (trava.por === 'papel' ? fraseDoPapel(trava.numero) : `${fraseDaNota(trava.numero)} Dá para corrigir o pagamento.`)

/** O comprador do formulário refeito campo a campo (#891): só os campos dele, e só os que vieram (ausente não muda nada). */
export function compradorDoFormulario(x: Record<string, unknown>): CompradorVenda {
  return Object.fromEntries(CAMPOS_DO_COMPRADOR.filter(k => x[k] !== undefined).map(k => [k, x[k]])) as CompradorVenda
}

/** O valor de cada acessório do formulário refeito campo a campo; null se a forma ou um valor não serve. */
export function acessoriosDoFormulario(x: unknown): { pecaId: string; valor: number }[] | null {
  const valido = (a: unknown): a is { pecaId: string; valor: number } => typeof a === 'object' && a !== null
    && typeof (a as { pecaId?: unknown }).pecaId === 'string' && typeof (a as { valor?: unknown }).valor === 'number'
    && !valorDePecaInvalido((a as { valor: number }).valor)
  return Array.isArray(x) && x.every(valido) ? x.map(a => ({ pecaId: a.pecaId, valor: a.valor })) : null
}

/**
 * A venda se edita pelo pedido (P6 do #23): o pedido tem 2+ vendas ou brinde/acessório (a venda de peça dele). A lista escolhe o
 * diálogo e o Editar venda recusa por aqui; venda de 1 moto sem peça (pedido ou Vender) segue no Editar venda.
 */
export const editaPeloPedido = (doPedido: { vendas: number; pecas: number }): boolean => doPedido.vendas > 1 || doPedido.pecas > 0
