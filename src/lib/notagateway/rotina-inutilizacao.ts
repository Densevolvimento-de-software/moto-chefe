import { limiteDaRotina, resumoDaRotina, type DesfechoDaRotina } from './inutilizacao'
import {
  consultarResultadoDaLinha, DEPENDENCIAS_CONSULTA, inutilizacoesPendentesAntesDe, type DependenciasConsulta, type InutilizacaoParaConsultar,
} from './inutilizar'

/** A consulta de uma pendente; o console vê só o nome do erro, nunca a mensagem, que pode ecoar o caminho com o `empresaId` (#607). */
async function desfechoDaPendente(linha: InutilizacaoParaConsultar, deps: DependenciasConsulta): Promise<DesfechoDaRotina> {
  try {
    const r = await consultarResultadoDaLinha(linha, deps)
    if (!r.ok) {
      console.error('[rotina inutilizacao] falha numa pendente (sem credencial no ambiente)')
      return 'falha'
    }
    return r.situacao === 'pendente' ? 'pendente' : 'resolvida'
  } catch (e) {
    console.error(`[rotina inutilizacao] falha numa pendente (${e instanceof Error ? e.name : 'erro'})`)
    return 'falha'
  }
}

/**
 * Rotina de hora em hora (#67): a pendente que passou do reenvio do aviso da NG, de todos os grupos, uma
 * por vez, pela mesma consulta do clique e do aviso (credencial do grupo da linha). A linha com falha segue
 * pendente para a próxima hora e não para as outras.
 */
export async function resolverPendentesSemAviso(agora: Date, deps: Omit<DependenciasConsulta, 'agora'> = DEPENDENCIAS_CONSULTA) {
  const pendentes = await inutilizacoesPendentesAntesDe(deps.exec, limiteDaRotina(agora))
  const comRelogio = { ...deps, agora: () => agora }
  const desfechos = await pendentes.reduce<Promise<DesfechoDaRotina[]>>(
    async (anteriores, linha) => [...await anteriores, await desfechoDaPendente(linha, comRelogio)],
    Promise.resolve([]),
  )
  const resumo = resumoDaRotina(desfechos)
  console.info(`[rotina inutilizacao] consultadas ${resumo.consultadas}, resolvidas ${resumo.resolvidas}, falhas ${resumo.falhas}`)
  return resumo
}
