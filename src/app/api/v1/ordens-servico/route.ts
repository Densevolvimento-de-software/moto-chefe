// GET /api/v1/ordens-servico (#325): ordens de serviço das lojas marcadas, com itens, por período e página. Sem sessão;
// a chave, o limite e o registro ficam na casca comChaveDaApi, porque o middleware não cobre /api.
import { NextRequest, NextResponse } from 'next/server'
import { periodoDaApi } from '@/lib/api-leitura-vendas'
import { lerCursorDaOS } from '@/lib/api-leitura-os'
import { comChaveDaApi } from '@/lib/queries/api-leitura'
import { listarOSDaApi } from '@/lib/queries/api-leitura-os'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const resposta = await comChaveDaApi(req.headers, '/api/v1/ordens-servico', async () => {
    const { searchParams } = req.nextUrl
    const periodo = periodoDaApi({ de: searchParams.get('de'), ate: searchParams.get('ate') })
    if (periodo === null) return { erro: 'parametro_invalido' as const }
    const cursor = lerCursorDaOS(searchParams.get('cursor'), periodo)
    if (!cursor.ok) return { erro: 'parametro_invalido' as const }
    const { ordens, proximaPagina } = await listarOSDaApi(periodo, cursor.cursor)
    return {
      corpo: { de: periodo.de, ate: periodo.ate, ordens, proximaPagina },
      linhas: ordens.length,
      periodo: { ini: periodo.de, fim: periodo.ate },
    }
  })
  return NextResponse.json(resposta.corpo, { status: resposta.status, headers: { 'Cache-Control': 'no-store', ...resposta.cabecalhos } })
}
