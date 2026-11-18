import { receberAvisoDaNg } from '@/lib/notagateway/aviso-webhook'
import { DEPENDENCIAS_CONSULTA } from '@/lib/notagateway/inutilizar'

export const dynamic = 'force-dynamic'

// Link cadastrado no painel da NG. A conta da NG é uma só para o MOVA: chegam aqui avisos de todas
// as Contas, do staging e da cópia local. A regra e os testes estão em aviso-webhook.ts.
export function POST(req: Request) {
  return receberAvisoDaNg(req, { ...DEPENDENCIAS_CONSULTA, tokenEsperado: process.env.NOTAGATEWAY_WEBHOOK_TOKEN })
}
