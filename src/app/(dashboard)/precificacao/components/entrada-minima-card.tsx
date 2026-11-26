'use client'
import { useState } from 'react'
import { toast } from 'sonner'
import { Lock, Save, Wallet } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  ENTRADA_MINIMA_PADRAO_PCT, PRECO_PIX_EXEMPLO, entradaMinimaPctDoCampo, minimoDaEntrada,
  type LojaComEntradaMinima,
} from '@/lib/entrada-minima-reserva'
import { fmtBRL } from '@/lib/preco-minimo'
import { salvarEntradaMinimaReservaAction } from '../actions'

const FRASE_CAMPO = 'Use um número inteiro de 0 a 100'
const EXEMPLO = fmtBRL(PRECO_PIX_EXEMPLO)

/** Entrada mínima da reserva de cada loja do grupo: uma porcentagem do preço PIX, salva de uma vez. */
export function EntradaMinimaCard({ lojas }: { lojas: LojaComEntradaMinima[] }) {
  const [valores, setValores] = useState<Record<string, string>>(() => Object.fromEntries(lojas.map(l => [l.id, String(l.pct)])))
  const [erro, setErro] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)

  const pctDe = (loja: LojaComEntradaMinima) => entradaMinimaPctDoCampo(valores[loja.id] ?? '')

  async function salvar() {
    if (salvando) return
    const pares = lojas.map(l => ({ lojaId: l.id, pct: pctDe(l) }))
    if (pares.some(p => p.pct === null)) {
      setErro('Corrija as porcentagens marcadas.')
      return
    }
    setErro(null)
    setSalvando(true)
    try {
      const r = await salvarEntradaMinimaReservaAction(pares)
      if (r.ok) toast.success('Entradas mínimas salvas')
      else setErro(r.erro)
    } catch {
      setErro('Não deu para salvar agora. Tente de novo.')
    } finally {
      setSalvando(false)
    }
  }

  return (
    <div className="bg-card rounded-xl border shadow-sm">
      <div className="px-4 sm:px-6 py-4 border-b flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold text-foreground flex items-center gap-2"><Wallet size={16} /> Entrada mínima da reserva</h2>
          <p className="text-xs text-muted-foreground mt-0.5">Quanto do preço PIX do modelo o cliente precisa dar de entrada para reservar. Cada loja tem a sua.</p>
        </div>
        <Button onClick={salvar} disabled={salvando || lojas.length === 0} className="gap-1.5"><Save size={16} /> Salvar entradas</Button>
      </div>

      {lojas.length === 0 ? (
        <p className="px-4 sm:px-6 py-4 text-sm text-muted-foreground">Nenhuma loja ativa neste grupo.</p>
      ) : (
        <div>
          <div className="hidden sm:grid grid-cols-[1fr_8rem_14rem] gap-4 bg-muted px-6 py-2.5 text-sm text-muted-foreground">
            <span>Loja</span><span>Entrada mínima</span><span className="text-right">Num modelo de {EXEMPLO}</span>
          </div>
          {lojas.map(loja => {
            const pct = pctDe(loja)
            return (
              <div key={loja.id} className="grid grid-cols-[1fr_auto] sm:grid-cols-[1fr_8rem_14rem] items-center gap-x-4 gap-y-1.5 border-t px-4 sm:px-6 py-3">
                <span className="font-semibold text-foreground">{loja.nome}</span>
                <div>
                  <div className="relative w-28 sm:w-full">
                    <Input
                      aria-label={`Entrada mínima da loja ${loja.nome}`}
                      aria-invalid={pct === null}
                      inputMode="numeric"
                      className="h-10 pr-8 text-right tabular-nums"
                      value={valores[loja.id] ?? ''}
                      disabled={salvando}
                      onChange={e => setValores(v => ({ ...v, [loja.id]: e.target.value }))}
                    />
                    <span aria-hidden className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">%</span>
                  </div>
                  {pct === null && <p className="mt-1 text-xs text-destructive">{FRASE_CAMPO}</p>}
                </div>
                <p className="col-span-2 sm:col-span-1 text-xs sm:text-sm text-muted-foreground sm:text-right tabular-nums">
                  <span className="sm:hidden">Num modelo de {EXEMPLO}: entrada de </span>
                  {pct !== null && <b className="font-semibold text-foreground">{fmtBRL(minimoDaEntrada(PRECO_PIX_EXEMPLO, pct))}</b>}
                </p>
              </div>
            )
          })}
        </div>
      )}

      {erro && <p role="alert" className="border-t px-4 sm:px-6 py-3 text-sm text-destructive">{erro}</p>}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t px-4 sm:px-6 py-3 text-xs text-muted-foreground">
        <p>Loja nova começa em {ENTRADA_MINIMA_PADRAO_PCT}%. Use de 0 a 100; 0 deixa reservar sem entrada mínima.</p>
        <p className="flex items-center gap-1.5"><Lock size={12} /> Só sócios e o admin veem e mudam</p>
      </div>
    </div>
  )
}
