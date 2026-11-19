import { NextRequest, NextResponse } from 'next/server'
import { cronAutorizado } from '@/lib/cron-auth'
import { resumoDaRodada, rodarTodosOsGrupos } from '@/lib/mercadopago/rodada'

// Grupos em sequência, cada um com 2 buscas paginadas no Mercado Pago.
export const maxDuration = 300
export const dynamic = 'force-dynamic'

// Uma vez por dia: importa a maquininha Mercado Pago de cada grupo com credencial (#51). Grupo que falha vem
// na contagem e pelo nome, com 200, como a rotina de inutilização (#67): tenta de novo na rodada seguinte.
export async function GET(req: NextRequest) {
  if (!cronAutorizado(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const resumo = resumoDaRodada(await rodarTodosOsGrupos())
  return NextResponse.json({ ok: true, ...resumo })
}
