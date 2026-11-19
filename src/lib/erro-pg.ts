// Erros do Postgres que a tela trata pelo código, vindos direto do driver ou embrulhados pelo Drizzle (em `cause`).

type ErroPg = { code?: unknown; cause?: { code?: unknown }; message?: unknown }

/** Chave única do Postgres (23505): o registro já existe, inclusive na corrida entre duas gravações. */
export function ehChaveDuplicada(e: unknown): boolean {
  if (typeof e !== 'object' || e === null) return false
  const { code, cause, message } = e as ErroPg
  const texto = typeof message === 'string' ? message : ''
  return code === '23505' || cause?.code === '23505' || texto.includes('unique') || texto.includes('duplicate key')
}
