// Rodada diária do Mercado Pago (#51): importa cada grupo com credencial. Um grupo que falha não para os
// outros; o erro guardado é só a mensagem conhecida (nunca token nem corpo cru da resposta).
import { RecusaUsuario } from '@/lib/resultado-action'
import { ErroMercadoPago } from './cliente'
import { CONTAGENS, gruposComMercadoPago, importarMercadoPagoDoGrupo, type ResultadoImportacaoMp } from './importar'

export type ResultadoDoGrupo = { grupo: string } & ({ ok: true; resultado: ResultadoImportacaoMp } | { ok: false; erro: string })

const mensagemConhecida = (e: unknown) =>
  e instanceof ErroMercadoPago || e instanceof RecusaUsuario ? e.message : 'erro interno'

export async function rodarTodosOsGrupos(deps: {
  grupos?: typeof gruposComMercadoPago
  importar?: typeof importarMercadoPagoDoGrupo
} = {}): Promise<ResultadoDoGrupo[]> {
  const { grupos = gruposComMercadoPago, importar = importarMercadoPagoDoGrupo } = deps
  // Um grupo por vez, como a rotina de inutilização (#67).
  return (await grupos()).reduce<Promise<ResultadoDoGrupo[]>>(
    async (anteriores, g) => [...await anteriores, await resultadoDoGrupo(g, importar)],
    Promise.resolve([]),
  )
}

async function resultadoDoGrupo(g: { id: string; nome: string }, importar: typeof importarMercadoPagoDoGrupo): Promise<ResultadoDoGrupo> {
  try {
    return { grupo: g.nome, ok: true, resultado: await importar(g.id) }
  } catch (e) {
    const erro = mensagemConhecida(e)
    console.error(`[conciliacao-mercadopago] ${g.nome}: ${erro}`)
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
