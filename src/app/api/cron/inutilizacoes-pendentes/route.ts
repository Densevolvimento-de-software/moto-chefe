import { NextRequest, NextResponse } from 'next/server'
import { cronAutorizado } from '@/lib/cron-auth'
import { resolverPendentesSemAviso } from '@/lib/notagateway/rotina-inutilizacao'

// Uma consulta à Nota Gateway por pendente, em sequência; a rotina para de começar consultas aos 240 s.
export const maxDuration = 300
export const dynamic = 'force-dynamic'

// De hora em hora: inutilização pendente que o aviso da NG não resolveu (#67). Falha numa linha vem
// na contagem, com 200: a linha tenta de novo na hora seguinte (decisão do Luis).
export async function GET(req: NextRequest) {
  if (!cronAutorizado(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const resumo = await resolverPendentesSemAviso(new Date())
  return NextResponse.json({ ok: true, ...resumo })
}
