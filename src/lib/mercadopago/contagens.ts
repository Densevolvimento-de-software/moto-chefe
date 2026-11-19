// Contagens da importação do Mercado Pago (#51): uma lista só para o desfecho de cada pagamento, o resumo da
// importação, o da rodada (cron) e a faixa da /conciliacao. Puro, sem banco: a faixa roda no cliente.
export const CONTAGENS = ['conciliadas', 'pendentes', 'duplicadas', 'estornos', 'estornosSemLinha', 'naoTratados', 'ignorados'] as const
export type Contagem = (typeof CONTAGENS)[number]
export type ResultadoImportacaoMp = Record<Contagem, number>

/**
 * Por que um pagamento aprovado da maquininha não virou linha. `sem_liquido` vira linha sozinho numa rodada seguinte
 * (se o Mercado Pago mandar o líquido); `pre_pago` e `outro_meio` pedem o Forçar.
 */
export type MotivoNaoTratado = 'pre_pago' | 'outro_meio' | 'sem_liquido'

/** Pagamento aprovado da maquininha que não virou linha; `valor` e `data` (dia de Brasília) para a faixa. */
export type NaoTratadoMp = { motivo: MotivoNaoTratado; valor: number; data: string }

/** O que a importação boa grava em `ultimo_resumo` (0197) e a faixa lê. */
export type ResumoDaImportacao = { contagens: ResultadoImportacaoMp; naoTratados: NaoTratadoMp[] }
