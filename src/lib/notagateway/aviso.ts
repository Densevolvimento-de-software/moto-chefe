/**
 * Aviso da Nota Gateway (webhook): só dispara a consulta, nunca vale como resultado (#58).
 * Do corpo sai só o que acha a linha (id) e o que manda pular (ambiente).
 */
export type AvisoDeInutilizacao = { id: string; ambienteEmissao: string | null }

/**
 * O aviso de inutilização tem o formato da consulta da inutilização, sem `tipo` (resposta do
 * suporte da NG, comentário na #58); o de nota traz `tipo: "NF-e"` ou `"NFC-e"`
 * (https://docs.notagateway.com.br/v2/docs/webhook). O status tem os mesmos nomes nos dois,
 * por isso a separação é pelo formato.
 */
export function avisoDeInutilizacao(corpo: unknown): AvisoDeInutilizacao | null {
  if (typeof corpo !== 'object' || corpo === null || Array.isArray(corpo) || 'tipo' in corpo) return null
  const c = corpo as Record<string, unknown>
  if (typeof c.id !== 'string' || !c.id || c.numeroInicial == null || c.numeroFinal == null) return null
  return { id: c.id, ambienteEmissao: typeof c.ambienteEmissao === 'string' ? c.ambienteEmissao : null }
}

type LinhaDoAviso = { ambiente: string }

export type DecisaoDoAviso<L extends LinhaDoAviso> =
  | { acao: 'consultar'; linha: L }
  | { acao: 'ignorar'; motivo: 'id desconhecido' | 'ambiente diferente' }

/**
 * Ordem da spec (#58): id desconhecido, depois ambiente diferente, para que um id do staging que
 * coincida com um da produção não dispare nada. Aviso sem ambiente conta como diferente (D1, #66).
 * Linha já resolvida não se decide aqui: a consulta do clique, que o aviso reusa, já não vai à NG.
 */
export function decidirAviso<L extends LinhaDoAviso>(aviso: AvisoDeInutilizacao, linha: L | null): DecisaoDoAviso<L> {
  if (!linha) return { acao: 'ignorar', motivo: 'id desconhecido' }
  if (aviso.ambienteEmissao !== linha.ambiente) return { acao: 'ignorar', motivo: 'ambiente diferente' }
  return { acao: 'consultar', linha }
}
