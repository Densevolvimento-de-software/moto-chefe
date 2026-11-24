// Contas do mcp.ai de outro CNPJ que o admin libera para a tela PIX (#236). Só PIX: Despesas, saldos e
// cartões seguem só com as contas do CNPJ do grupo.

export type LiberacaoPix = { chavePropria: boolean; ids: readonly string[] }

/**
 * A conta entra no PIX? Do CNPJ do grupo, sempre; de outro CNPJ, só com id liberado E chave própria do
 * mcp.ai: na chave global da env (de outra empresa) o id liberado não vale, nem que esteja gravado.
 */
export function contaEntraNoPix(conta: { id: string; doCnpjDoGrupo: boolean }, liberacao: LiberacaoPix): boolean {
  return conta.doCnpjDoGrupo || (liberacao.chavePropria && liberacao.ids.includes(conta.id))
}

const MAX_IDS = 20
// Formato real do id do mcp.ai não conferido: aceita só o que não quebra a leitura (letra, número, - e _).
const ID_VALIDO = /^[A-Za-z0-9_-]{1,100}$/

export type IdsContasPix = { ok: true; ids: string[] } | { ok: false; erro: string }

/** Texto do campo (vírgula, espaço ou quebra de linha) em lista de ids, sem vazios nem repetidos. */
export function lerIdsContasPix(texto: string): IdsContasPix {
  const ids = [...new Set(texto.split(/[\s,;]+/).filter(Boolean))]
  if (ids.some(id => !ID_VALIDO.test(id))) {
    return { ok: false, erro: 'ID de conta inválido: use só letras, números, - e _ (até 100 caracteres).' }
  }
  if (ids.length > MAX_IDS) return { ok: false, erro: `No máximo ${MAX_IDS} contas por grupo.` }
  return { ok: true, ids }
}

/** O grupo terá chave própria do mcp.ai depois de salvar? Remover vence; senão chave nova ou a que já havia. */
export function chavePropriaAposSalvar(o: { jaTinha: boolean; chaveNova: boolean; remover: boolean }): boolean {
  return !o.remover && (o.jaTinha || o.chaveNova)
}

/** Ids a gravar. Lista vazia sempre pode (apagar); id sem chave própria é recusado. */
export function idsContasPixParaGravar(o: { texto: string; chavePropriaAposSalvar: boolean }): IdsContasPix {
  const lidos = lerIdsContasPix(o.texto)
  if (!lidos.ok) return lidos
  if (lidos.ids.length > 0 && !o.chavePropriaAposSalvar) {
    return { ok: false, erro: 'Só dá para liberar contas com a chave própria do mcp.ai deste grupo. Cadastre a chave antes.' }
  }
  return lidos
}
