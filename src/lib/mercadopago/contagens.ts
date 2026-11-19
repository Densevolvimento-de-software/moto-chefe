// Contagens da importação do Mercado Pago (#51): uma lista só para o desfecho de cada pagamento, o resumo da
// importação, o da rodada (cron) e a faixa da /conciliacao. Puro, sem banco: a faixa roda no cliente.
export const CONTAGENS = ['conciliadas', 'pendentes', 'duplicadas', 'estornos', 'estornosSemLinha', 'naoTratados', 'ignorados'] as const
export type Contagem = (typeof CONTAGENS)[number]
export type ResultadoImportacaoMp = Record<Contagem, number>

/**
 * Pagamento aprovado da maquininha que não virou linha. `valor` e `data` (dia de Brasília) só para a faixa;
 * `entraDepois`: vira linha sozinho numa rodada seguinte (sem líquido), em vez de pedir o Forçar (meio fora).
 */
export type NaoTratadoMp = { motivo: string; valor: number; data: string; entraDepois: boolean }

/** O que a importação boa grava em `ultimo_resumo` (0197) e a faixa lê. */
export type ResumoDaImportacao = { contagens: ResultadoImportacaoMp; naoTratados: NaoTratadoMp[] }
