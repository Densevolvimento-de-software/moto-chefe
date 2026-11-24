import { centavos } from '@/lib/centavos'
import type { IndicadorIe } from '@/lib/documento'
import { parseNumeroBR } from '@/lib/numero-br'

/**
 * DIFAL da NF-e interestadual para consumidor final que não contribui com ICMS (#247).
 *
 * O MOVA manda o grupo do DIFAL em `itens[].impostos.icms`; sem ele a Nota Gateway monta o
 * destino sozinha com a interestadual da dupla de UFs (12%) e a SEFAZ recusa a origem 2, que
 * exige 4% (rejeição 697). A alíquota interna do destino e o FCP vêm de quem emite, na tela:
 * não há tabela por UF (docs/fiscal/ng-difal.md).
 */

/** O que quem emite informa, já lido como número. */
export type DifalDigitado = { aliquotaInterna: number; percentualFcp: number }

/** Os campos do `icms` que a Nota Gateway lê (manual da NG; o de partilha só vem do suporte). */
export type CamposDifalIcms = {
  baseCalculoUFDestinoDifal: number
  aliquotaUFDestinoDifal: number
  valorUFDestinoDifal: number
  valorUFOrigemDifal: number
  aliquotaInterestadualDifal: number
  percentualPartilhaInterestadualDifal: number
  baseCalculoFundoCombatePobrezaDifal: number
  percentualFCPDifal: number
  valorFCPDifal: number
}

export const SEM_ALIQUOTA_INTERNA =
  'Venda para outro estado, para quem não contribui com ICMS: informe a alíquota interna do estado do comprador (e o FCP, se houver).'

/** Decisão do Luis (#247): só não contribuinte. Sem indicador, a nota já sai como não contribuinte. */
export function exigeDifal(o: { interestadual: boolean; indicadorIe: IndicadorIe | null | undefined }): boolean {
  return o.interestadual && (o.indicadorIe ?? 'nao_contribuinte') === 'nao_contribuinte'
}

const percentual = (n: number | null): n is number => n !== null && n >= 0 && n <= 100

/**
 * Lê o que veio do navegador. Devolve um objeto novo com só os dois campos: o resto do que o
 * pedido trouxer (valores, grupo) nunca chega à nota (#891).
 */
export function validarDifalDigitado(
  entrada: unknown, aliquotaInterestadual: number | null,
): { ok: true; dados: DifalDigitado } | { ok: false; erro: string } {
  if (aliquotaInterestadual === null) {
    return { ok: false, erro: 'A regra fiscal do grupo está sem a alíquota interestadual: confira em Admin → Notas fiscais.' }
  }
  const bruto = typeof entrada === 'object' && entrada !== null ? (entrada as Record<string, unknown>) : {}
  const { aliquotaInterna: internaBruta, fcp: fcpBruto = '' } = bruto
  if (internaBruta === undefined || internaBruta === null || (typeof internaBruta === 'string' && !internaBruta.trim())) {
    return { ok: false, erro: SEM_ALIQUOTA_INTERNA }
  }
  const interna = typeof internaBruta === 'string' ? parseNumeroBR(internaBruta) : null
  if (!percentual(interna)) return { ok: false, erro: 'A alíquota interna do estado do comprador precisa ser um número entre 0 e 100.' }
  if (interna < aliquotaInterestadual) {
    return { ok: false, erro: `A alíquota interna (${interna}%) é menor que a interestadual da regra (${aliquotaInterestadual}%): confira o valor.` }
  }
  const fcp = typeof fcpBruto === 'string' ? (fcpBruto.trim() ? parseNumeroBR(fcpBruto) : 0) : null
  if (!percentual(fcp)) return { ok: false, erro: 'O FCP precisa ser um número entre 0 e 100, ou ficar vazio.' }
  return { ok: true, dados: { aliquotaInterna: interna, percentualFcp: fcp } }
}

/**
 * Base única: a base do destino é o valor da operação, e o DIFAL é a diferença entre a
 * alíquota interna e a interestadual. Partilha de 100% para o destino (valor da origem 0).
 */
export function camposDifalIcms(p: { valor: number; aliquotaInterestadual: number; difal: DifalDigitado }): CamposDifalIcms {
  const { valor, aliquotaInterestadual, difal } = p
  return {
    baseCalculoUFDestinoDifal: valor,
    aliquotaUFDestinoDifal: difal.aliquotaInterna,
    valorUFDestinoDifal: centavos((valor * (difal.aliquotaInterna - aliquotaInterestadual)) / 100),
    valorUFOrigemDifal: 0,
    aliquotaInterestadualDifal: aliquotaInterestadual,
    percentualPartilhaInterestadualDifal: 100,
    baseCalculoFundoCombatePobrezaDifal: valor,
    percentualFCPDifal: difal.percentualFcp,
    valorFCPDifal: centavos((valor * difal.percentualFcp) / 100),
  }
}
