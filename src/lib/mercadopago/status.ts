// Status do pagamento no Mercado Pago em que o dinheiro voltou ao comprador: devolução (refunded) e
// contestação (charged_back). 'cancelled' fica de fora: é pagamento cancelado antes de aprovar.
// Lista única para a mensalidade (webhook.ts) e para a maquininha (conciliacao-mercadopago.ts).
const STATUS_ESTORNO = new Set(['refunded', 'charged_back'])

export const ehEstornoMp = (status: string): boolean => STATUS_ESTORNO.has(status)
