'use client'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { PAGAMENTO_PIX, TIPOS_CARTAO, matchPagamentos, type PgtoOS } from '@/lib/conciliacao-status'
import { PagamentosConciliacao, useConciliacaoAlvo } from '@/components/pagamentos-conciliacao'

type Props = { osId: string; pagamentos: PgtoOS[]; papel: string }

export function OSConciliacaoPanel({ osId, pagamentos, papel }: Props) {
  const temCartao = pagamentos.some(p => TIPOS_CARTAO.has(p.tipo))
  const temPix    = pagamentos.some(p => PAGAMENTO_PIX.has(p.tipo))

  const dados = useConciliacaoAlvo({ tipo: 'os', id: osId }, temCartao || temPix)

  if (!temCartao && !temPix) return null // dinheiro/transferência/cortesia/gratuita — não precisa conciliar

  // Mesma conta do painel, para a dica não sumir quando o PIX entrou só em parte.
  const cobertura   = matchPagamentos(pagamentos, dados.concs, dados.pixRecs)
  const pixPendente = pagamentos.some((p, i) => PAGAMENTO_PIX.has(p.tipo) && !cobertura[i].conciliado)

  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-sm">Conciliação</CardTitle></CardHeader>
      <CardContent className="space-y-2">
        <PagamentosConciliacao
          alvo={{ tipo: 'os', id: osId }}
          pagamentos={pagamentos}
          dados={dados}
          papel={papel}
          somenteConciliaveis
        />

        {!dados.loading && pixPendente && (
          <p className="text-xs text-muted-foreground">
            PIX pendente: toque no pagamento acima para procurar o PIX na maquininha Mercado Pago ou no extrato do banco.
          </p>
        )}
      </CardContent>
    </Card>
  )
}
