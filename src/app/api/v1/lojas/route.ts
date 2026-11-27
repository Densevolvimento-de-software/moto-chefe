// GET /api/v1/lojas (#319): lojas marcadas como MotoChefe. Sem sessão; a chave, o limite e o registro ficam na
// casca comChaveDaApi, porque o middleware não cobre /api.
import { NextRequest, NextResponse } from 'next/server'
import { comChaveDaApi, listarLojasDaApi } from '@/lib/queries/api-leitura'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const resposta = await comChaveDaApi(req.headers, '/api/v1/lojas', async () => {
    const lojas = await listarLojasDaApi()
    return { corpo: { lojas }, linhas: lojas.length }
  })
  return NextResponse.json(resposta.corpo, { status: resposta.status, headers: { 'Cache-Control': 'no-store', ...resposta.cabecalhos } })
}
