// Regras puras do catálogo de Serviços (sem banco). Ficam fora de servicos-da-conta.ts, que
// importa o pool do banco, para o teste de unidade rodar sem DATABASE_URL.

// admin_rede chega aqui como admin_socio (usuarioDaRede). Na persona de grupo liberado de outra
// Conta (grupoLiberado preenchido) ele vê o catálogo e usa na OS, mas não gerencia (ADR-0019, adendo).
export function podeGerirServicos(usuario: { papel: string; grupoLiberado?: string | null }): boolean {
  return ['admin_geral', 'admin_socio'].includes(usuario.papel) && !usuario.grupoLiberado
}

/** Frase de recusa para nome ou valor inválido; `null` quando o serviço pode ser gravado. */
export function recusaDoServico(input: { nome: string; valor: number }): string | null {
  if (!input.nome.trim()) return 'Nome é obrigatório'
  // NaN passa em `< 0` e String(NaN) chegaria ao banco.
  if (!Number.isFinite(input.valor)) return 'Valor inválido'
  if (input.valor < 0) return 'Valor não pode ser negativo'
  return null
}
