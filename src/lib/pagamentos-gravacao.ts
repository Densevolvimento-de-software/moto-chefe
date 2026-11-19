import { centavos } from './centavos'
import type { PgtoOS } from './conciliacao-status'
import type { PagamentoEntrada } from './pagamentos-entrada'

// O que se grava em cada pagamento vindo da tela. A marca de conciliação forçada fica de fora:
// só o servidor a grava (comForcado), e na edição ela vem do registro já gravado (#891).
type CampoDaTela = Exclude<keyof PgtoOS, 'conciliadoManual'>

export const CAMPOS_PAGAMENTO_VENDA = ['tipo', 'valor', 'operadora', 'parcelas', 'autorizacao'] as const satisfies readonly CampoDaTela[]
export const CAMPOS_PAGAMENTO_OS = [...CAMPOS_PAGAMENTO_VENDA, 'cupom'] as const satisfies readonly CampoDaTela[]
export const CAMPOS_PAGAMENTO_ENTRADA = ['tipo', 'valor', 'operadora', 'parcelas'] as const satisfies readonly (keyof PagamentoEntrada)[]

const textoOuNumero = (v: unknown): v is string | number => typeof v === 'string' || typeof v === 'number'

function soOsCampos(pagamento: unknown, campos: readonly CampoDaTela[]): PgtoOS {
  const origem = (pagamento ?? {}) as Record<string, unknown>
  return Object.fromEntries(campos.filter(c => textoOuNumero(origem[c])).map(c => [c, origem[c]])) as PgtoOS
}

// "O mesmo pagamento" para a marca: o tipo e o valor que ela atestou. Operadora, parcelas e
// autorização não contam (decisão do Luis no #151).
const mesmoPagamento = (a: PgtoOS, b: PgtoOS) =>
  a.tipo === b.tipo && centavos(Number(a.valor)) === centavos(Number(b.valor))

/**
 * Os pagamentos da tela prontos para gravar: só os `campos` do alvo, com texto ou número. A marca
 * de forçada de cada um vem de `gravados` (o registro lido no banco), do pagamento gravado com
 * o mesmo tipo e valor, cada marca usada uma vez. Na criação, `gravados` é vazio.
 */
export function pagamentosParaGravar(daTela: readonly PgtoOS[], campos: readonly CampoDaTela[], gravados: unknown): PgtoOS[] {
  const anteriores = (Array.isArray(gravados) ? gravados : []) as PgtoOS[]
  return daTela.reduce<{ saida: readonly PgtoOS[]; usados: ReadonlySet<number> }>((acc, pagamento) => {
    const limpo = soOsCampos(pagamento, campos)
    const i = anteriores.findIndex((g, j) => !acc.usados.has(j) && Boolean(g?.conciliadoManual) && mesmoPagamento(g, limpo))
    if (i < 0) return { saida: [...acc.saida, limpo], usados: acc.usados }
    return {
      saida: [...acc.saida, { ...limpo, conciliadoManual: anteriores[i].conciliadoManual }],
      usados: new Set([...acc.usados, i]),
    }
  }, { saida: [], usados: new Set() }).saida as PgtoOS[]
}
