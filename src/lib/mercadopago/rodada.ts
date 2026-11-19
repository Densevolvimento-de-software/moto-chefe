// Rodada diária do Mercado Pago (#51): importa cada grupo com credencial. Um grupo que falha não para os
// outros; o erro guardado é só a mensagem conhecida (nunca token nem corpo cru da resposta).
import { RecusaUsuario } from '@/lib/resultado-action'
import { ErroMercadoPago } from './cliente'
import { gruposComMercadoPago, importarMercadoPagoDoGrupo, registrarFalhaMp } from './importar'
import { CONTAGENS, type ResultadoImportacaoMp } from './contagens'

export type ResultadoDoGrupo = { grupo: string } & ({ ok: true; resultado: ResultadoImportacaoMp } | { ok: false; erro: string })

const mensagemConhecida = (e: unknown) =>
  e instanceof ErroMercadoPago || e instanceof RecusaUsuario ? e.message : 'erro interno'

type DependenciasDoGrupo = { importar?: typeof importarMercadoPagoDoGrupo; registrarFalha?: typeof registrarFalhaMp }

export async function rodarTodosOsGrupos(deps: DependenciasDoGrupo & { grupos?: typeof gruposComMercadoPago } = {}): Promise<ResultadoDoGrupo[]> {
  const { grupos = gruposComMercadoPago, ...doGrupo } = deps
  // Um grupo por vez, como a rotina de inutilização (#67).
  return (await grupos()).reduce<Promise<ResultadoDoGrupo[]>>(
    async (anteriores, g) => [...await anteriores, await resultadoDoGrupo(g, doGrupo)],
    Promise.resolve([]),
  )
}

/**
 * Importa um grupo; a falha volta só com a frase conhecida e fica guardada para a faixa da /conciliacao. A rotina
 * e o botão Importar (só o grupo ativo) passam por aqui.
 */
export async function resultadoDoGrupo(g: { id: string; nome: string }, deps: DependenciasDoGrupo = {}): Promise<ResultadoDoGrupo> {
  const { importar = importarMercadoPagoDoGrupo, registrarFalha = registrarFalhaMp } = deps
  // A importação boa grava a própria hora de início; a falha usa a mesma régua (ver registrarFalhaMp).
  const inicio = new Date()
  try {
    return { grupo: g.nome, ok: true, resultado: await importar(g.id, { agora: inicio }) }
  } catch (e) {
    const erro = mensagemConhecida(e)
    // Erro desconhecido: só o nome no log, nunca a mensagem, que pode trazer segredo (como a rotina de inutilização).
    const pista = erro === 'erro interno' ? ` (${e instanceof Error ? e.name : 'erro'})` : ''
    console.error(`[conciliacao-mercadopago] ${g.nome}: ${erro}${pista}`)
    // Gravar a falha não pode derrubar a rodada dos outros grupos.
    await registrarFalha(g.id, erro, inicio)
      .catch((e2: unknown) => console.error(`[conciliacao-mercadopago] ${g.nome}: falha não registrada (${e2 instanceof Error ? e2.name : 'erro'})`))
    return { grupo: g.nome, ok: false, erro }
  }
}

/** Resposta do cron (decisão D2 do Luis): as contagens somadas e o nome dos grupos que falharam. */
export function resumoDaRodada(rs: readonly ResultadoDoGrupo[]) {
  const importados = rs.flatMap(r => (r.ok ? [r.resultado] : []))
  const somas = Object.fromEntries(CONTAGENS.map(k => [k, importados.reduce((s, x) => s + x[k], 0)])) as ResultadoImportacaoMp
  const gruposComFalha = rs.filter(r => !r.ok).map(r => r.grupo)
  return { grupos: rs.length, ...somas, falhas: gruposComFalha.length, gruposComFalha }
}
