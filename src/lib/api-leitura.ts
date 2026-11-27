// Regra da API de leitura da MotoChefe Brasil (#315, ADR-0021). Puro: sem banco e sem relógio.
// Quem chama passa o instante (`agora`) e as linhas lidas do banco.
import type { Origem } from '@/lib/log-acoes'

/** Tempo que a chave trocada continua valendo depois da troca (ADR-0021). */
export const CARENCIA_MS = 24 * 60 * 60 * 1000

/** Teto de pedidos por chave na janela de tempo (spec #315). */
export const LIMITE_POR_MINUTO = 60

const MINUTO_MS = 60 * 1000

export type ChaveNoBanco = { id: string; hash: string; validaAte: Date | null; revogadaEm: Date | null }
export type PlanoDaTroca = { revogar: string[]; expirar: { id: string; validaAte: Date }[] }
export type LojaDaApi = { id: string; nome: string; cidade: string; endereco: string; cep: string | null; ativa: boolean }
export type CodigoErroApi = 'acesso_negado' | 'erro_interno' | 'limite_atingido'

/** Chave vale se não foi revogada e, quando tem validade, ela ainda não passou. */
export function chaveAceita(chave: Pick<ChaveNoBanco, 'validaAte' | 'revogadaEm'>, agora: Date): boolean {
  return chave.revogadaEm === null && (chave.validaAte === null || chave.validaAte.getTime() > agora.getTime())
}

/**
 * O que a troca faz com as chaves não revogadas. A atual (sem validade) entra em carência de 24h.
 * Chave já em carência (ou vencida) sai na hora: recusar a troca deixaria uma chave possivelmente
 * vazada valendo até 24h. Assim, no máximo uma atual e uma em carência valem ao mesmo tempo.
 */
export function planoDaTroca(chavesNaoRevogadas: ChaveNoBanco[], agora: Date): PlanoDaTroca {
  const validaAte = new Date(agora.getTime() + CARENCIA_MS)
  return {
    revogar: chavesNaoRevogadas.filter(c => c.validaAte !== null).map(c => c.id),
    expirar: chavesNaoRevogadas.filter(c => c.validaAte === null).map(c => ({ id: c.id, validaAte })),
  }
}

/** Só estas seis colunas saem da loja, qualquer que seja o que o banco devolva (ADR-0021). */
export function linhaDaLoja(linha: LojaDaApi): LojaDaApi {
  return { id: linha.id, nome: linha.nome, cidade: linha.cidade, endereco: linha.endereco, cep: linha.cep, ativa: linha.ativa }
}

/** Início da janela em que o instante cai. */
export function janelaDoMinuto(agora: Date): Date {
  return new Date(Math.floor(agora.getTime() / MINUTO_MS) * MINUTO_MS)
}

/** `pedidos` já inclui o pedido atual. */
export function passouDoLimite(pedidos: number): boolean {
  return pedidos > LIMITE_POR_MINUTO
}

/** Segundos até a janela seguinte: é o Retry-After da recusa. */
export function segundosAteProximaJanela(agora: Date): number {
  return Math.ceil((janelaDoMinuto(agora).getTime() + MINUTO_MS - agora.getTime()) / 1000)
}

// Lista única de erros da API: os endpoints novos acrescentam códigos aqui.
const ERROS: Record<CodigoErroApi, { status: number; frase: string }> = {
  acesso_negado: { status: 401, frase: 'Acesso negado.' },
  erro_interno: { status: 500, frase: 'Erro interno.' },
  limite_atingido: { status: 429, frase: 'Limite de chamadas atingido.' },
}

export function corpoDoErro(codigo: CodigoErroApi): { codigo: CodigoErroApi; frase: string } {
  return { codigo, frase: ERROS[codigo].frase }
}

export function statusDoErro(codigo: CodigoErroApi): number {
  return ERROS[codigo].status
}

/** Forma da resposta HTTP da API: o status, o corpo e os cabeçalhos extras que a rota devolve. */
export type RespostaDaApi = { status: number; corpo: unknown; cabecalhos?: Record<string, string> }

export function respostaDeErro(codigo: CodigoErroApi): RespostaDaApi {
  return { status: statusDoErro(codigo), corpo: corpoDoErro(codigo) }
}

/** Recusa por limite: 429 com o Retry-After dos segundos que faltam para a janela virar. */
export function respostaDeLimite(agora: Date): RespostaDaApi {
  return { ...respostaDeErro('limite_atingido'), cabecalhos: { 'Retry-After': String(segundosAteProximaJanela(agora)) } }
}

/** O que a casca sabe de cada chamada: quem chamou, o quê e o que devolveu. Período e página são opcionais. */
export type PeriodoDoAcesso = { ini: string; fim: string }
export type ResultadoDoMiolo = { corpo: unknown; linhas?: number; periodo?: PeriodoDoAcesso | null; pagina?: number | null }
export type EntradaDoAcesso = {
  chaveId: string | null; endpoint: string; status: number; origem: Origem
  periodo?: PeriodoDoAcesso | null; pagina?: number | null; linhas?: number | null
}
export type LinhaDoAcesso = {
  chaveId: string | null; endpoint: string; status: number; ip: string | null; userAgent: string | null
  periodoIni: string | null; periodoFim: string | null; pagina: number | null; linhas: number | null
}

// 45 é o tamanho máximo de um IPv6 escrito por extenso com prefixo IPv4 embutido. Corta aqui, não no helper de origem.
const TAMANHO_MAX_IP = 45

/** Só estas colunas vão para api_acessos (ADR-0021): nunca a chave, o Authorization nem trecho do pedido. */
export function linhaDoAcesso(entrada: EntradaDoAcesso): LinhaDoAcesso {
  return {
    chaveId: entrada.chaveId,
    endpoint: entrada.endpoint,
    status: entrada.status,
    ip: entrada.origem.ip?.slice(0, TAMANHO_MAX_IP) ?? null,
    userAgent: entrada.origem.userAgent,
    periodoIni: entrada.periodo?.ini ?? null,
    periodoFim: entrada.periodo?.fim ?? null,
    pagina: entrada.pagina ?? null,
    linhas: entrada.linhas ?? null,
  }
}
