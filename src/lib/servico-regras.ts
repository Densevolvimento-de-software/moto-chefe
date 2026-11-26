// Regras puras do catálogo de Serviços (sem banco). Ficam fora de servicos-da-conta.ts, que
// importa o pool do banco, para o teste de unidade rodar sem DATABASE_URL.

// admin_rede chega aqui como admin_socio (usuarioDaRede). Na persona de grupo liberado de outra
// Conta (grupoLiberado preenchido) ele vê o catálogo e usa na OS, mas não gerencia (ADR-0019, adendo).
export function podeGerirServicos(usuario: { papel: string; grupoLiberado?: string | null }): boolean {
  return ['admin_geral', 'admin_socio'].includes(usuario.papel) && !usuario.grupoLiberado
}
