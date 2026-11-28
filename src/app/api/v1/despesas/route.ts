// GET /api/v1/despesas (#326): despesas por mês, loja e categoria (com o grupo do DRE), das lojas marcadas de Conta
// autorizada, e a empresa geral por CNPJ com loja marcada. Sem sessão; a chave, o limite e o registro ficam na casca
// comChaveDaApi, porque o middleware não cobre /api.
import { NextRequest, NextResponse } from 'next/server'
import { periodoDeMesesDaApi, periodoParaAcesso } from '@/lib/api-leitura-metas'
import { lerCursorDeDespesas } from '@/lib/api-leitura-despesas'
import { comChaveDaApi } from '@/lib/queries/api-leitura'
import { listarDespesasDaApi } from '@/lib/queries/api-leitura-despesas'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const resposta = await comChaveDaApi(req.headers, '/api/v1/despesas', async () => {
    const { searchParams } = req.nextUrl
    const periodo = periodoDeMesesDaApi({ de: searchParams.get('de'), ate: searchParams.get('ate') })
    if (periodo === null) return { erro: 'parametro_invalido' as const }
    const cursor = lerCursorDeDespesas(searchParams.get('cursor'), periodo)
    if (!cursor.ok) return { erro: 'parametro_invalido' as const }
    const { despesas, proximaPagina } = await listarDespesasDaApi(periodo, cursor.cursor)
    return {
      corpo: { de: periodo.de, ate: periodo.ate, despesas, proximaPagina },
      linhas: despesas.length,
      periodo: periodoParaAcesso(periodo),
    }
  })
  return NextResponse.json(resposta.corpo, { status: resposta.status, headers: { 'Cache-Control': 'no-store', ...resposta.cabecalhos } })
}
