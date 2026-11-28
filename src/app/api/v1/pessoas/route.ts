// GET /api/v1/pessoas (#324): vendedores, mecânicos e auxiliares das lojas marcadas, com página por id. Sem sessão; a
// chave, o limite e o registro ficam na casca comChaveDaApi, porque o middleware não cobre /api.
import { NextRequest, NextResponse } from 'next/server'
import { lerCursorDePessoas } from '@/lib/api-leitura-pessoas'
import { comChaveDaApi } from '@/lib/queries/api-leitura'
import { listarPessoasDaApi } from '@/lib/queries/api-leitura-pessoas'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const resposta = await comChaveDaApi(req.headers, '/api/v1/pessoas', async () => {
    const cursor = lerCursorDePessoas(req.nextUrl.searchParams.get('cursor'))
    if (!cursor.ok) return { erro: 'parametro_invalido' as const }
    const { pessoas, proximaPagina } = await listarPessoasDaApi(cursor.cursor)
    return { corpo: { pessoas, proximaPagina }, linhas: pessoas.length }
  })
  return NextResponse.json(resposta.corpo, { status: resposta.status, headers: { 'Cache-Control': 'no-store', ...resposta.cabecalhos } })
}
