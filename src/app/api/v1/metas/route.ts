// GET /api/v1/metas (#326): metas mensais das lojas marcadas de Conta autorizada, com período e página. Sem sessão;
// a chave, o limite e o registro ficam na casca comChaveDaApi, porque o middleware não cobre /api.
import { NextRequest, NextResponse } from 'next/server'
import { lerCursorDeMetas, periodoDeMesesDaApi, periodoParaAcesso } from '@/lib/api-leitura-metas'
import { comChaveDaApi } from '@/lib/queries/api-leitura'
import { listarMetasDaApi } from '@/lib/queries/api-leitura-metas'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const resposta = await comChaveDaApi(req.headers, '/api/v1/metas', async () => {
    const { searchParams } = req.nextUrl
    const periodo = periodoDeMesesDaApi({ de: searchParams.get('de'), ate: searchParams.get('ate') })
    if (periodo === null) return { erro: 'parametro_invalido' as const }
    const cursor = lerCursorDeMetas(searchParams.get('cursor'), periodo)
    if (!cursor.ok) return { erro: 'parametro_invalido' as const }
    const { metas, proximaPagina } = await listarMetasDaApi(periodo, cursor.cursor)
    return {
      corpo: { de: periodo.de, ate: periodo.ate, metas, proximaPagina },
      linhas: metas.length,
      periodo: periodoParaAcesso(periodo),
    }
  })
  return NextResponse.json(resposta.corpo, { status: resposta.status, headers: { 'Cache-Control': 'no-store', ...resposta.cabecalhos } })
}
