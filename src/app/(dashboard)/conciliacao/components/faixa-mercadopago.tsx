'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronDown, CreditCard, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useAcaoDemorada } from '@/hooks/use-acao-demorada'
import { detalhesDaFaixa, fraseDaFalha, fraseDoNaoTratado, numerosDaFaixa, rotuloDaUltima } from '@/lib/mercadopago/faixa'
import type { EstadoDaFaixaMp } from '@/lib/mercadopago/importar'

type Props = {
  estado: EstadoDaFaixaMp
  /** Quem gere a conciliação (`podeGerirConciliacao`) vê o "Importar agora". */
  podeImportar: boolean
}

/**
 * Faixa do Mercado Pago na /conciliacao (#51, V2 escolhida pelo Luis): a última importação do grupo ativo (rotina
 * diária ou botão), com 4 números, os não tratados e a falha da última rodada. Desktop: 4 caixas; celular: os 4
 * números numa linha só, sem rolagem lateral. O resultado vem gravado do servidor: o botão importa e recarrega.
 */
export function FaixaMercadoPago({ estado, podeImportar }: Props) {
  const router = useRouter()
  const { pendente, disparar } = useAcaoDemorada<{ ok: true }>('/api/conciliacao/mercadopago')
  const [erro, setErro] = useState<string | null>(null)

  async function importar() {
    // O botão fica travado enquanto importa (teste de tela); isto é só a segunda trava.
    if (pendente) return
    setErro(null)
    const r = await disparar({})
    if (!r.ok) setErro(r.erro)
    router.refresh()
  }

  const resumo = estado.resumo
  // A falha do Mercado Pago volta pela rota e também fica gravada: a frase gravada já diz, sem repetir.
  const erroDoBotao = erro !== null && erro !== estado.falha?.erro ? erro : null

  return (
    <section aria-label="Mercado Pago" className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-start gap-3">
        <CreditCard className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="font-semibold">Mercado Pago</p>
          <p className="text-xs text-muted-foreground">
            {pendente ? 'Importando do Mercado Pago. Pode levar alguns minutos.' : rotuloDaUltima(estado.ultimaImportacaoEm)}
          </p>
        </div>
        {podeImportar && (
          <Button
            variant="outline"
            onClick={importar}
            disabled={pendente}
            className="size-11 shrink-0 p-0 md:h-9 md:w-auto md:px-3"
          >
            <RefreshCw className={cn('size-4', pendente && 'animate-spin')} aria-hidden />
            <span className="sr-only md:not-sr-only">{pendente ? 'Importando' : 'Importar agora'}</span>
          </Button>
        )}
      </div>

      {resumo && (
        <dl className="mt-3 grid grid-cols-4 divide-x divide-border border-t border-border pt-2.5 md:gap-2.5 md:divide-x-0 md:border-t-0 md:pt-0">
          {numerosDaFaixa(resumo.contagens).map(n => (
            <div key={n.rotulo} className="flex min-w-0 flex-col-reverse justify-end px-1 text-center md:rounded-lg md:border md:border-border md:px-2.5 md:py-2 md:text-left">
              <dt className="text-[11px] leading-tight text-muted-foreground md:text-xs">
                {n.rotulo}
                {n.nota && <span className="mt-0.5 hidden text-[11px] md:block">{n.nota}</span>}
              </dt>
              <dd className={cn('text-lg font-bold tabular-nums md:text-xl', n.alerta && 'text-warning')}>{n.valor}</dd>
            </div>
          ))}
        </dl>
      )}

      {resumo && resumo.naoTratados.length > 0 && (
        <ul className="mt-3 space-y-1 text-xs text-warning">
          {resumo.naoTratados.map((n, i) => <li key={i}>{fraseDoNaoTratado(n)}</li>)}
        </ul>
      )}

      {estado.falha && (
        <p role="alert" className="mt-3 text-xs text-destructive">{fraseDaFalha(estado.falha.em, estado.falha.erro)}</p>
      )}
      {erroDoBotao && (
        <p role="alert" className="mt-3 text-xs text-destructive">Não deu para importar: {erroDoBotao}</p>
      )}

      {resumo && (
        <details className="group mt-3 border-t border-border">
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between text-sm font-medium text-primary-text">
            Ver detalhes <ChevronDown className="size-4 transition-transform group-open:rotate-180" aria-hidden />
          </summary>
          <dl className="divide-y divide-border text-sm">
            {detalhesDaFaixa(resumo.contagens).map(l => (
              <div key={l.rotulo} className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 py-2">
                <dt className={cn(l.alerta && 'text-warning')}>
                  {l.rotulo}
                  <span className="block text-xs text-muted-foreground">{l.explica}</span>
                </dt>
                <dd className={cn('font-semibold tabular-nums', l.alerta && 'text-warning')}>{l.valor}</dd>
              </div>
            ))}
          </dl>
        </details>
      )}
    </section>
  )
}
