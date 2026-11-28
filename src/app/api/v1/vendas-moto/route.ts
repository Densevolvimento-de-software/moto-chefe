// GET /api/v1/vendas-moto (#323): vendas de moto MotoChefe das lojas marcadas, com período e página. Sem sessão; a
// chave, o limite e o registro ficam na casca comChaveDaApi, porque o middleware não cobre /api.
import { NextRequest, NextResponse } from 'next/server'
import { lerCursor, periodoDaApi } from '@/lib/api-leitura-vendas'
import { comChaveDaApi } from '@/lib/queries/api-leitura'
import { listarVendasMotoDaApi } from '@/lib/queries/api-leitura-vendas'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const resposta = await comChaveDaApi(req.headers, '/api/v1/vendas-moto', async () => {
    const { searchParams } = req.nextUrl
    const periodo = periodoDaApi({ de: searchParams.get('de'), ate: searchParams.get('ate') })
    if (periodo === null) return { erro: 'parametro_invalido' as const }
    const cursor = lerCursor(searchParams.get('cursor'), periodo)
    if (!cursor.ok) return { erro: 'parametro_invalido' as const }
    const { vendas, proximaPagina } = await listarVendasMotoDaApi(periodo, cursor.cursor)
    return {
      corpo: { de: periodo.de, ate: periodo.ate, vendas, proximaPagina },
      linhas: vendas.length,
      periodo: { ini: periodo.de, fim: periodo.ate },
    }
  })
  return NextResponse.json(resposta.corpo, { status: resposta.status, headers: { 'Cache-Control': 'no-store', ...resposta.cabecalhos } })
}
