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

/**
 * A NF que trava o pedido: a mesma regra do "Cancelar venda" (ADR-0014, `travaDoCancelamentoDaVenda`) e, para o aux_adm, o
 * nº de NF preenchido (#191), em qualquer venda do pedido. null se nada trava.
 */
export function nfQueTravaOPedido(
  vendas: readonly { notas: readonly NotaDaTrava[]; notaFiscalSaida: string | null }[], papel: string, agora: Date,
): { numero: string | null } | null {
  const daNota = vendas.map(v => travaDoCancelamentoDaVenda([...v.notas], agora)).find(r => r !== null)
  if (daNota) return { numero: daNota.nota.numero }
  const doPapel = vendas.find(v => travaDoPapel(papel, v.notaFiscalSaida))
  return doPapel ? { numero: doPapel.notaFiscalSaida } : null
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
export function recusaDaEdicaoNaNota(trava: { numero: string | null } | null, clienteOuValorMudou: boolean): string | null {
  if (!trava || !clienteOuValorMudou) return null
  const nota = trava.numero ? `A nota fiscal nº ${trava.numero}` : 'A nota fiscal do pedido'
  return `${nota} está valendo. Itens, valores e cliente estão nela e não mudam. Para mudar, cancele a nota antes.`
}

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
