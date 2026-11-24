// Quem mexe na conciliação de um pagamento: procura o lançamento, vincula, força e desfaz.
// Uma lista só para a tela (src/components/pagamentos-conciliacao.tsx) e para as actions
// (conciliacao/actions.ts). Em Peças, uma cópia desalinhada entre tela e action derrubou a página.
// Forçar deixou de ser só do admin_geral em 18/11/2026 (#79, decisão do Luis): Conta cliente
// sem Open Finance precisa fechar a pendência quando o dinheiro entrou por outro caminho.
import { COMPLETA_FORCADA, COMPLETA_FORCADA_PEDIR_A_GESTOR } from './conciliacao-status'

const GESTORES_CONCILIACAO = ['admin_geral', 'admin_socio', 'aux_adm'] as const

export function podeGerirConciliacao(papel: string): boolean {
  return (GESTORES_CONCILIACAO as readonly string[]).includes(papel)
}

// Forçar e desfazer forçada (#220): admin_geral e admin_socio sempre; aux_adm só se a opção do grupo
// da loja do registro estiver ligada. Os demais papéis não forçam, mesmo com a opção ligada.
export function podeForcarConciliacao(papel: string, auxAdmPodeForcar: boolean): boolean {
  if (papel === 'admin_geral' || papel === 'admin_socio') return true
  return papel === 'aux_adm' && auxAdmPodeForcar
}

// O desvincular de um PIX que completa uma forçada: quem pode desfazer recebe a frase que manda desfazer;
// quem não pode recebe a que manda pedir ao gestor (a mesma escolha em /pix-mcp e /conciliacao).
export function fraseDeCompletaForcada(podeForcar: boolean): string {
  return podeForcar ? COMPLETA_FORCADA : COMPLETA_FORCADA_PEDIR_A_GESTOR
}
