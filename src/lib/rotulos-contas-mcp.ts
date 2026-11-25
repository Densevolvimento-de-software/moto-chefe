// Rótulo que a tela de Editar Grupo mostra ao lado de cada ID de conta ou credencial do mcp.ai (#253).
// Só o que ajuda a reconhecer o ID: nome do banco e tipo. Número, agência e CNPJ não entram aqui.

export const NAO_ENCONTRADO = 'Não encontrado nesta chave'
/** Frase única para qualquer falha de consulta ao mcp.ai: a URL da chave tem segredo e o erro dele não sobe para a tela. */
export const FALHA_AO_ROTULAR = 'Não foi possível consultar o mcp.ai agora.'

/** Uma conta como a chave a enxerga, já sem nada além do que o rótulo usa. `banco` vem de `nomeDaConta`. */
export type ContaDaChave = {
  id: string
  itemId?: string
  subtype: string
  banco: string
  lista: 'BANK' | 'CREDIT'
}

export type RotuloConta = { id: string; texto: string }

const NAO_ENTRA = '(não entra no PIX)'

function rotuloDaConta(c: ContaDaChave): string {
  if (c.lista === 'CREDIT') return `${c.banco}, cartão ${NAO_ENTRA}`
  if (c.subtype === 'SAVINGS_ACCOUNT') return `${c.banco}, poupança ${NAO_ENTRA}`
  return `${c.banco}, conta`
}

/** Credencial = as contas que dividem o mesmo `itemId`. Pelo PIX, só as correntes dela valem. */
function rotuloDaCredencial(contas: readonly ContaDaChave[]): string {
  const banco = (contas.find(c => c.lista === 'BANK') ?? contas[0]).banco
  const correntes = contas.filter(c => c.lista === 'BANK' && c.subtype === 'CHECKING_ACCOUNT').length
  if (correntes > 0) return `${banco}, credencial, ${correntes} ${correntes === 1 ? 'conta corrente' : 'contas correntes'}`
  if (contas.every(c => c.lista === 'CREDIT')) return `${banco}, credencial, só cartão ${NAO_ENTRA}`
  return `${banco}, credencial, nenhuma conta corrente`
}

/** Um rótulo por conta (pelo id dela) e um por credencial (pelo `itemId`). */
export function montarRotulos(contas: readonly ContaDaChave[]): RotuloConta[] {
  const porCredencial = Map.groupBy(contas.filter(c => c.itemId !== undefined), c => c.itemId as string)
  return [
    ...contas.map(c => ({ id: c.id, texto: rotuloDaConta(c) })),
    ...[...porCredencial].map(([itemId, doItem]) => ({ id: itemId, texto: rotuloDaCredencial(doItem) })),
  ]
}
