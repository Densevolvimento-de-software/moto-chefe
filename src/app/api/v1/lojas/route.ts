// GET /api/v1/lojas (#319): lojas marcadas como MotoChefe. Sem sessão; a chave é conferida na casca
// comChaveDaApi, porque o middleware não cobre /api.
import { NextRequest, NextResponse } from 'next/server'
import { comChaveDaApi, listarLojasDaApi } from '@/lib/queries/api-leitura'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const resposta = await comChaveDaApi(req.headers.get('authorization'), async () => ({ lojas: await listarLojasDaApi() }))
  return NextResponse.json(resposta.corpo, { status: resposta.status, headers: { 'Cache-Control': 'no-store' } })
}
