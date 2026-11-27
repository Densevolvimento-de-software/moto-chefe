import { NextRequest, NextResponse } from 'next/server'
import { cronAutorizado } from '@/lib/cron-auth'
import { apagarLogAntigo } from '@/lib/log-acoes'
import { apagarAcessosAntigos, apagarJanelasAntigas } from '@/lib/queries/api-leitura'

export const dynamic = 'force-dynamic'

// O log guarda 12 meses (#198); o registro da API (#320) e a janela do limite saem pela mesma rotina.
export async function GET(req: NextRequest) {
  if (!cronAutorizado(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const apagadas = await apagarLogAntigo()
  const acessos = await apagarAcessosAntigos()
  const janelas = await apagarJanelasAntigas()
  return NextResponse.json({ ok: true, apagadas, acessos, janelas })
}
