// Regras da tela da chave da API (#322). Puro: sem banco e sem relógio; quem chama passa o instante.
import { CARENCIA_MS } from '@/lib/api-leitura'

const HORA_MS = 60 * 60 * 1000
const FORMATO_BRT = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
})

/** Data e hora de Brasília no formato da tela: 28/11/2026, 09:05. */
export function dataHoraBrt(instante: Date): string {
  return FORMATO_BRT.format(instante)
}

/** Horas inteiras que faltam até o prazo acabar, arredondadas para cima; nunca negativas. */
export function horasQueFaltam(validaAte: Date, agora: Date): number {
  return Math.max(0, Math.ceil((validaAte.getTime() - agora.getTime()) / HORA_MS))
}

export function textoFaltam(horas: number): string {
  return horas === 1 ? 'Falta 1 hora' : `Faltam ${horas} horas`
}

/** Quanto do prazo de 24 horas da chave anterior já passou, de 0 a 100. */
export function progressoDoPrazo(validaAte: Date, agora: Date): number {
  const inicio = validaAte.getTime() - CARENCIA_MS
  const passou = ((agora.getTime() - inicio) / CARENCIA_MS) * 100
  return Math.round(Math.min(100, Math.max(0, passou)))
}

/** Texto da confirmação de trocar: com chave anterior no prazo, diz até quando ela vale e que para na hora. */
export function textoDaTroca(anteriorValeAte: Date | null): string {
  const atual = 'Gerar uma chave nova. A chave atual vale por mais 24 horas.'
  return anteriorValeAte
    ? `${atual} A chave anterior, que vale até ${dataHoraBrt(anteriorValeAte)}, para na hora.`
    : atual
}
