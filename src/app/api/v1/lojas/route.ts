// GET /api/v1/lojas (#319): lojas marcadas como MotoChefe. Sem sessão; a chave é conferida aqui, porque o
// middleware não cobre /api. Qualquer falha de chave recebe a mesma resposta, sem dado.
import { NextRequest, NextResponse } from 'next/server'
import { corpoDoErro, statusDoErro, tokenDoBearer, type CodigoErroApi } from '@/lib/api-leitura'
import { buscarChaveAceita, listarLojasDaApi } from '@/lib/queries/api-leitura'

export const dynamic = 'force-dynamic'

const erro = (codigo: CodigoErroApi) => NextResponse.json(corpoDoErro(codigo), { status: statusDoErro(codigo) })

export async function GET(req: NextRequest) {
  try {
    if ((await buscarChaveAceita(tokenDoBearer(req.headers.get('authorization')), new Date())) === null) {
      return erro('acesso_negado')
    }
    return NextResponse.json({ lojas: await listarLojasDaApi() })
  } catch {
    // Sem log do erro: a mensagem do banco traz a consulta com os parâmetros, e um deles é o hash da chave.
    return erro('erro_interno')
  }
}
