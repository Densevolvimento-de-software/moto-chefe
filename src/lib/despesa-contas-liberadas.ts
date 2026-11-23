export type ContaLiberadaDespesa = { banco: string; inicioEm: Date | null }

/**
 * A saída entra na despesa? Só se o banco estiver liberado para o grupo e a data
 * já passar do início da liberação (sem início, vale desde sempre).
 */
export function saidaEntraNaDespesa(banco: string, data: Date, liberadas: ContaLiberadaDespesa[]): boolean {
  const conta = liberadas.find(c => c.banco === banco)
  if (!conta) return false
  return conta.inicioEm === null || data.getTime() >= conta.inicioEm.getTime()
}
