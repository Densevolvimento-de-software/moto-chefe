// Regra da API de leitura da MotoChefe Brasil (#315, ADR-0021). Puro: sem banco e sem relógio.
// Quem chama passa o instante (`agora`) e as linhas lidas do banco.

/** Tempo que a chave trocada continua valendo depois da troca (ADR-0021). */
export const CARENCIA_MS = 24 * 60 * 60 * 1000

export type ChaveNoBanco = { id: string; hash: string; validaAte: Date | null; revogadaEm: Date | null }
export type PlanoDaTroca = { revogar: string[]; expirar: { id: string; validaAte: Date }[] }
export type LojaDaApi = { id: string; nome: string; cidade: string; endereco: string; cep: string | null; ativa: boolean }
export type CodigoErroApi = 'acesso_negado' | 'erro_interno'

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

// Lista única de erros da API: os endpoints novos (#320 e seguintes) acrescentam códigos aqui.
const ERROS: Record<CodigoErroApi, { status: number; frase: string }> = {
  acesso_negado: { status: 401, frase: 'Acesso negado.' },
  erro_interno: { status: 500, frase: 'Erro interno.' },
}

export function corpoDoErro(codigo: CodigoErroApi): { codigo: CodigoErroApi; frase: string } {
  return { codigo, frase: ERROS[codigo].frase }
}

export function statusDoErro(codigo: CodigoErroApi): number {
  return ERROS[codigo].status
}

/** Forma da resposta HTTP da API: o status e o corpo que a rota devolve. */
export type RespostaDaApi = { status: number; corpo: unknown }

export function respostaDeErro(codigo: CodigoErroApi): RespostaDaApi {
  return { status: statusDoErro(codigo), corpo: corpoDoErro(codigo) }
}
