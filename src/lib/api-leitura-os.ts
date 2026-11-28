// Regra da API de ordens de serviço (#325, ADR-0021). Puro: sem banco e sem relógio. Quem chama passa as linhas
// que o banco devolveu, já filtradas pelas lojas que saem e pelo período.
import type { Periodo } from '@/lib/api-leitura-vendas'
import { codificarCursorObjeto, decodificarCursorObjeto } from '@/lib/api-leitura-pagina'
import { hojeBrt } from '@/lib/data-venda'
import { ehUuid } from '@/lib/uuid'

/** Tipo do item no MOVA (os_itens.tipo) e o nome que sai. Único lugar que faz essa troca. */
export const TIPO_DO_ITEM = { servico: 'mao_de_obra', peca: 'peca' } as const satisfies Record<string, string>
export type TipoDoItemDaApi = typeof TIPO_DO_ITEM[keyof typeof TIPO_DO_ITEM]

export type LinhaOSBanco = {
  id: string; numero: number | null; status: string
  dataAbertura: Date; dataConclusao: Date | null
  lojaId: string; lojaNome: string
  tecnicoId: string | null; tecnicoNome: string | null
  motoId: string | null; chassiMoto: string | null; chassiOs: string | null
  marcaExterna: string | null; modeloExterno: string | null
  valorTotal: number | null
}

/** Item já com o valor da linha calculado no banco (quantidade x valor unitário, 2 casas). */
export type ItemOSBanco = { osId: string; tipo: string; quantidade: number; valorUnitario: number; valor: number }
export type ItemDaApi = { tipo: TipoDoItemDaApi; quantidade: number; valorUnitario: number; valor: number }

export type OSDaApi = {
  id: string; numero: number | null; status: string
  abertura: string; conclusao: string | null
  loja: { id: string; nome: string }
  tecnico: { id: string; nome: string } | null
  chassi: string | null; marca: string | null; modelo: string | null
  itens: ItemDaApi[]; total: number
}

/** Ordem da página: data de abertura até o milissegundo e id da OS (desempate). */
export type Cursor = { d: string; i: string }

function itemDaApi(item: ItemOSBanco): ItemDaApi | null {
  if (!Object.hasOwn(TIPO_DO_ITEM, item.tipo)) return null
  return { tipo: TIPO_DO_ITEM[item.tipo as keyof typeof TIPO_DO_ITEM], quantidade: item.quantidade, valorUnitario: item.valorUnitario, valor: item.valor }
}

/** Moto do estoque sai só com chassi. Moto de fora sai com marca, modelo e o chassi informado na OS. */
function veiculoDaOS(linha: LinhaOSBanco): Pick<OSDaApi, 'chassi' | 'marca' | 'modelo'> {
  if (linha.motoId !== null) return { chassi: linha.chassiMoto, marca: null, modelo: null }
  return { chassi: linha.chassiOs, marca: linha.marcaExterna, modelo: linha.modeloExterno }
}

function osDaApi(linha: LinhaOSBanco, itens: ItemOSBanco[]): OSDaApi {
  return {
    id: linha.id,
    numero: linha.numero,
    status: linha.status,
    abertura: linha.dataAbertura.toISOString(),
    conclusao: linha.dataConclusao?.toISOString() ?? null,
    loja: { id: linha.lojaId, nome: linha.lojaNome },
    tecnico: linha.tecnicoId === null || linha.tecnicoNome === null ? null : { id: linha.tecnicoId, nome: linha.tecnicoNome },
    ...veiculoDaOS(linha),
    itens: itens.map(itemDaApi).filter((i): i is ItemDaApi => i !== null),
    // Número sempre: OS sem total gravado sai 0.
    total: linha.valorTotal ?? 0,
  }
}

/** Junta cada OS da página aos seus itens. Itens são lidos só das OS da página; a OS sem item sai com lista vazia. */
export function montarOSDaApi(linhas: LinhaOSBanco[], itens: ItemOSBanco[]): OSDaApi[] {
  const porOS = new Map<string, ItemOSBanco[]>()
  for (const item of itens) porOS.set(item.osId, [...(porOS.get(item.osId) ?? []), item])
  return linhas.map(linha => osDaApi(linha, porOS.get(linha.id) ?? []))
}

export function cursorDaUltimaOS(linha: { dataAbertura: Date; id: string }): Cursor {
  return { d: linha.dataAbertura.toISOString(), i: linha.id }
}

export function codificarCursorDaOS(cursor: Cursor): string {
  return codificarCursorObjeto({ d: cursor.d, i: cursor.i })
}

/**
 * Lê o cursor da página. Valida campo a campo: só as chaves d e i, data em ISO com milissegundo (a ida e a volta
 * têm de dar o mesmo texto), id que é uuid, e data de Brasília dentro do período pedido. Sem cursor é a 1ª página.
 */
export function lerCursorDaOS(texto: string | null, periodo: Periodo): { ok: true; cursor: Cursor | null } | { ok: false } {
  if (texto === null) return { ok: true, cursor: null }
  const valor = decodificarCursorObjeto(texto)
  if (valor === null || Object.keys(valor).sort().join(',') !== 'd,i') return { ok: false }
  const { d, i } = valor
  if (typeof d !== 'string' || typeof i !== 'string' || !ehUuid(i)) return { ok: false }
  const instante = Date.parse(d)
  if (Number.isNaN(instante) || new Date(instante).toISOString() !== d) return { ok: false }
  const dia = hojeBrt(new Date(instante))
  if (dia < periodo.de || dia > periodo.ate) return { ok: false }
  return { ok: true, cursor: { d, i } }
}
