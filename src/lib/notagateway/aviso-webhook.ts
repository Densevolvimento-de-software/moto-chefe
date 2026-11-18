import { iguaisEmTempoConstante } from '@/lib/tempo-constante'
import { avisoDeInutilizacao, decidirAviso } from './aviso'
import { consultarResultadoDaLinha, inutilizacaoPeloIdExterno, type DependenciasConsulta } from './inutilizar'

/** O token esperado vem do servidor (conta única da NG, exceção do ADR-0010); o teste troca a NG e o banco. */
export type DependenciasAviso = DependenciasConsulta & { tokenEsperado: string | undefined }

/**
 * Uma linha de console por aviso, só com o resultado: nunca o corpo, o id, o token nem o
 * `empresaId`. A NG reenvia até receber 200 (https://docs.notagateway.com.br/v2/docs/webhook).
 */
function responder(status: number, resultado: string): Response {
  ;(status >= 500 ? console.error : console.info)(`[webhook notagateway] ${resultado}`)
  return Response.json({ resultado }, { status })
}

/**
 * Aviso da NG: só gatilho (#58). Acha a inutilização pelo id externo, e daí em diante vale a
 * linha do banco (grupo, ambiente, credencial) e a mesma consulta do clique "Consultar resultado".
 */
export async function receberAvisoDaNg(req: Request, deps: DependenciasAviso): Promise<Response> {
  if (!deps.tokenEsperado) return responder(503, 'recusado: token do webhook não configurado')
  const token = req.headers.get('x-token')
  if (!token || !iguaisEmTempoConstante(token, deps.tokenEsperado)) return responder(401, 'recusado: x-token inválido')

  const aviso = avisoDeInutilizacao(await req.json().catch(() => null))
  if ('ignorar' in aviso) return responder(200, `ignorado: ${aviso.ignorar}`)

  try {
    const decisao = decidirAviso(aviso, await inutilizacaoPeloIdExterno(deps.exec, aviso.id))
    if (decisao.acao === 'ignorar') return responder(200, `ignorado: ${decisao.motivo}`)
    // Linha que já não está pendente (aviso repetido) volta com o que está gravado, sem ir à NG.
    const r = await consultarResultadoDaLinha(decisao.linha, deps)
    // Sem credencial no ambiente da linha: segue pendente, como no clique; reenviar não muda nada.
    if (!r.ok) return responder(200, 'ignorado: grupo sem credencial no ambiente da inutilização')
    // A NG avisou, mas a consulta ainda diz pendente (atraso dela): 500 para reenviar. Ela tenta "até receber o
    // status HTTP 200", 15 vezes em cerca de 4 h (https://docs.notagateway.com.br/v2/docs/webhook); depois
    // disso resolve o clique ou a rotina do #67. Decisão do Luis no #66.
    if (r.situacao === 'pendente') return responder(500, 'ainda pendente na consulta: a NG reenvia')
    return responder(200, `situação: ${r.situacao}`)
  } catch (e) {
    // Banco fora ou NG com erro (5xx, 4xx, rede): 500 para a NG reenviar (D2, #66). Só o nome do erro.
    return responder(500, `falha passageira (${e instanceof Error ? e.name : 'erro'})`)
  }
}
