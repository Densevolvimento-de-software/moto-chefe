import { desfechoDaConsulta, limiteDaRotina, orcamentoEsgotado, resumoDaRotina, type DesfechoDaRotina } from './inutilizacao'
import {
  consultarResultadoDaLinha, DEPENDENCIAS_CONSULTA, inutilizacoesPendentesAntesDe, type DependenciasConsulta, type InutilizacaoParaConsultar,
} from './inutilizar'

/** A consulta de uma pendente; o console vê só o nome do erro, nunca a mensagem, que pode ecoar o caminho com o `empresaId` (#607). */
async function desfechoDaPendente(linha: InutilizacaoParaConsultar, deps: DependenciasConsulta): Promise<DesfechoDaRotina> {
  try {
    const desfecho = desfechoDaConsulta(await consultarResultadoDaLinha(linha, deps))
    if (desfecho === 'falha') console.error('[rotina inutilizacao] falha numa pendente (sem credencial no ambiente)')
    return desfecho
  } catch (e) {
    console.error(`[rotina inutilizacao] falha numa pendente (${e instanceof Error ? e.name : 'erro'})`)
    return 'falha'
  }
}

/** A consulta de cada linha, mais o relógio que mede o tempo gasto pela rodada (o teste o adianta). */
export type DependenciasDaRotina = Omit<DependenciasConsulta, 'agora'> & { relogioMs: () => number }

const DEPENDENCIAS_DA_ROTINA: DependenciasDaRotina = { ...DEPENDENCIAS_CONSULTA, relogioMs: Date.now }

/**
 * Rotina de hora em hora (#67): a pendente que passou do reenvio do aviso da NG, de todos os grupos, uma
 * por vez, pela mesma consulta do clique e do aviso (credencial do grupo da linha). A linha com falha segue
 * pendente para a próxima hora e não para as outras. Esgotado o orçamento de tempo, as que faltam ficam adiadas.
 */
export async function resolverPendentesSemAviso(agora: Date, deps: DependenciasDaRotina = DEPENDENCIAS_DA_ROTINA) {
  const pendentes = await inutilizacoesPendentesAntesDe(deps.exec, limiteDaRotina(agora))
  const depsDaConsulta = { ...deps, agora: () => agora }
  const inicio = deps.relogioMs()
  const desfechos = await pendentes.reduce<Promise<DesfechoDaRotina[]>>(
    async (anteriores, linha) => {
      const feitos = await anteriores
      if (orcamentoEsgotado(deps.relogioMs() - inicio)) return [...feitos, 'adiada']
      return [...feitos, await desfechoDaPendente(linha, depsDaConsulta)]
    },
    Promise.resolve([]),
  )
  const resumo = resumoDaRotina(desfechos)
  console.info(`[rotina inutilizacao] consultadas ${resumo.consultadas}, resolvidas ${resumo.resolvidas}, falhas ${resumo.falhas}, adiadas ${resumo.adiadas}`)
  return resumo
}
