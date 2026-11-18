// Quem mexe na conciliação de um pagamento: procura o lançamento, vincula, força e desfaz.
// Uma lista só para a tela (src/components/pagamentos-conciliacao.tsx) e para as actions
// (conciliacao/actions.ts). Em Peças, uma cópia desalinhada entre tela e action derrubou a página.
// Forçar deixou de ser só do admin_geral em 18/11/2026 (#79, decisão do Luis): Conta cliente
// sem Open Finance precisa fechar a pendência quando o dinheiro entrou por outro caminho.
const GESTORES_CONCILIACAO = ['admin_geral', 'admin_socio', 'aux_adm'] as const

export function podeGerirConciliacao(papel: string): boolean {
  return (GESTORES_CONCILIACAO as readonly string[]).includes(papel)
}
