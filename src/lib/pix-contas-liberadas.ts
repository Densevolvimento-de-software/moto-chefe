// Contas do mcp.ai de outro CNPJ que o admin libera para a tela PIX (#236). Só PIX: Despesas, saldos e
// cartões seguem só com as contas do CNPJ do grupo.

export type LiberacaoPix = { chavePropria: boolean; ids: readonly string[] }

/**
 * A conta entra no PIX? Do CNPJ do grupo, sempre; de outro CNPJ, só com id liberado E chave própria do
 * mcp.ai: na chave global da env (de outra empresa) o id liberado não vale, nem que esteja gravado.
 * O id liberado pode ser o da conta ou o da credencial dela (`itemId`, a conexão com o banco; #253). Pela
 * credencial entra só conta corrente: outro tipo de conta da mesma conexão fica fora.
 */
export function contaEntraNoPix(
  conta: { id: string; itemId?: string; subtype?: string; doCnpjDoGrupo: boolean },
  liberacao: LiberacaoPix,
): boolean {
  const pelaConta = liberacao.ids.includes(conta.id)
  const pelaCredencial = conta.itemId !== undefined && conta.subtype === 'CHECKING_ACCOUNT' && liberacao.ids.includes(conta.itemId)
  return conta.doCnpjDoGrupo || (liberacao.chavePropria && (pelaConta || pelaCredencial))
}

const MAX_IDS = 20
// Formato real do id do mcp.ai não conferido: aceita só o que não quebra a leitura (letra, número, ponto, - e _).
const ID_VALIDO = /^[A-Za-z0-9_.-]{1,100}$/

export type IdsContasPix = { ok: true; ids: string[] } | { ok: false; erro: string }

/** Texto do campo (vírgula, espaço ou quebra de linha) em lista de ids, sem vazios nem repetidos. */
export function lerIdsContasPix(texto: string): IdsContasPix {
  const ids = [...new Set(texto.split(/[\s,;]+/).filter(Boolean))]
  if (ids.some(id => !ID_VALIDO.test(id))) {
    return { ok: false, erro: 'ID de conta inválido: use só letras, números, ponto, - e _ (até 100 caracteres).' }
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

/**
 * O que o pedido de editar o grupo faz com os ids. `ids: undefined` = não mexer na coluna (campo não veio);
 * lista = substituir (vazia apaga). Remover a chave apaga os ids junto: eles valem só com a chave que os listou.
 */
export function idsContasPixDoPedido(o: {
  // `unknown`: o campo vem do navegador (Server Action) e o tipo declarado não vale em execução.
  texto: unknown
  jaTinha: boolean
  chaveNova: boolean
  remover: boolean
}): { ok: true; ids: string[] | undefined } | { ok: false; erro: string } {
  if (o.texto === undefined) return { ok: true, ids: o.remover ? [] : undefined }
  if (typeof o.texto !== 'string') return { ok: false, erro: 'Lista de IDs de conta inválida.' }
  return idsContasPixParaGravar({ texto: o.texto, chavePropriaAposSalvar: chavePropriaAposSalvar(o) })
}
