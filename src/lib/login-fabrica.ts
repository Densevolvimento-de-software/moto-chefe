// Login da fábrica MotoChefe (papel `fabrica`, #892): só lê o painel em /fabrica e sai.
// Regra pura, sem banco: o middleware decide por ela, e o servidor (getUsuarioLogado)
// recusa pedido de ação pela mesma régua quando o middleware não validou.
import { ROTA_PAINEL_FABRICA } from '@/lib/painel-fabrica'

export const PAPEL_FABRICA = 'fabrica'
/** Sair por POST numa rota, não Server Action: o login da fábrica não chama action nenhuma. */
export const ROTA_SAIR = '/sair'
export const ROTA_CONTA_DESATIVADA = '/conta-desativada'

export type DecisaoLoginFabrica =
  | { tipo: 'seguir' }
  | { tipo: 'redirecionar'; para: string }
  | { tipo: 'recusar' }

const LEITURA = ['GET', 'HEAD']

const noPainel = (caminho: string) => caminho === ROTA_PAINEL_FABRICA || caminho.startsWith(`${ROTA_PAINEL_FABRICA}/`)

/**
 * O que fazer com um pedido do login da fábrica. Só leitura (GET/HEAD) e o POST de sair:
 * uma Server Action pode ser chamada de qualquer página pelo id, então prender só a rota
 * não basta. Leitura fora do painel, de /conta-desativada e do sair volta ao painel.
 */
export function decisaoDoLoginFabrica({ caminho, metodo }: { caminho: string; metodo: string }): DecisaoLoginFabrica {
  const m = metodo.toUpperCase()
  if (!LEITURA.includes(m)) return m === 'POST' && caminho === ROTA_SAIR ? { tipo: 'seguir' } : { tipo: 'recusar' }
  const livre = noPainel(caminho) || caminho === ROTA_CONTA_DESATIVADA || caminho === ROTA_SAIR
  return livre ? { tipo: 'seguir' } : { tipo: 'redirecionar', para: ROTA_PAINEL_FABRICA }
}

const CORPO_DE_FORMULARIO = /^(multipart\/form-data|application\/x-www-form-urlencoded)\b/i

/**
 * Pedido que executa Server Action: o cabeçalho `next-action` (chamada pelo JS) ou um
 * formulário enviado sem JS (multipart ou urlencoded), que o Next também executa (r1 do #893).
 * Leitura de página não traz corpo de formulário.
 */
export function ehPedidoDeAcao(cabecalhos: Pick<Headers, 'get'>): boolean {
  return cabecalhos.get('next-action') !== null || CORPO_DE_FORMULARIO.test(cabecalhos.get('content-type') ?? '')
}

/**
 * Sair é rota, não Server Action: não ganha a conferência de origem que o Next faz nas actions.
 * Formulário de outro site derrubaria a sessão; sem cabeçalho de origem, o navegador não mandou
 * de outro site (POST entre sites sempre leva Origin).
 */
export function saidaDeOutroSite(origem: string | null, origemDoSite: string): boolean {
  return origem !== null && origem !== origemDoSite
}

/** Para onde vai quem abre a área /fabrica sem acesso a ela. O login da fábrica não volta ao
 * Dashboard (o middleware o traria de volta, num laço): vai à tela com Sair. */
export function destinoSemPainel(papel: string): string {
  return papel === PAPEL_FABRICA ? ROTA_CONTA_DESATIVADA : '/dashboard'
}
