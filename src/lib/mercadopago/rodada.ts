// Rodada diária do Mercado Pago (#51): importa cada grupo com credencial. Um grupo que falha não para os
// outros; o erro guardado é só a mensagem conhecida (nunca token nem corpo cru da resposta).
import { RecusaUsuario } from '@/lib/resultado-action'
import { ErroMercadoPago } from './cliente'
import { gruposComMercadoPago, importarMercadoPagoDoGrupo, type ResultadoImportacaoMp } from './importar'

export type ResultadoDoGrupo = { grupo: string } & ({ ok: true; resultado: ResultadoImportacaoMp } | { ok: false; erro: string })

const mensagemConhecida = (e: unknown) =>
  e instanceof ErroMercadoPago || e instanceof RecusaUsuario ? e.message : 'erro interno'

export async function rodarTodosOsGrupos(deps: {
  grupos?: typeof gruposComMercadoPago
  importar?: typeof importarMercadoPagoDoGrupo
} = {}): Promise<ResultadoDoGrupo[]> {
  const { grupos = gruposComMercadoPago, importar = importarMercadoPagoDoGrupo } = deps
  const saida: ResultadoDoGrupo[] = []
  for (const g of await grupos()) {
    try {
      saida.push({ grupo: g.nome, ok: true, resultado: await importar(g.id) })
    } catch (e) {
      const erro = mensagemConhecida(e)
      console.error(`[conciliacao-mercadopago] ${g.nome}: ${erro}`)
      saida.push({ grupo: g.nome, ok: false, erro })
    }
  }
  return saida
}

/** Resposta do cron (decisão D2 do Luis): as contagens somadas e o nome dos grupos que falharam. */
export function resumoDaRodada(rs: readonly ResultadoDoGrupo[]) {
  const importados = rs.flatMap(r => (r.ok ? [r.resultado] : []))
  const soma = (k: keyof ResultadoImportacaoMp) => importados.reduce((s, x) => s + x[k], 0)
  const gruposComFalha = rs.filter(r => !r.ok).map(r => r.grupo)
  return {
    grupos: rs.length,
    importadas: soma('importadas'),
    duplicadas: soma('duplicadas'),
    conciliadas: soma('conciliadas'),
    estornos: soma('estornos'),
    naoTratados: soma('naoTratados'),
    ignorados: soma('ignorados'),
    falhas: gruposComFalha.length,
    gruposComFalha,
  }
}
