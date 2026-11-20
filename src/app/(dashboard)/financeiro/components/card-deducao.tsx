import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { brl } from '@/lib/dashboard-painel'

/** Quanto a dedução é do faturamento bruto, em pt-BR: "2,4%", "0,08%". */
export const percentualDoBruto = (valor: number, bruto: number) =>
  `${((valor / bruto) * 100).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 2 })}%`

/**
 * Card de dedução do Financeiro (Taxas Cartão, Tarifa PIX na maquininha, Custo PIX): o valor em vermelho e quanto é do
 * bruto; `detalhe` vem depois do percentual (ex.: "41 PIX conciliados").
 */
export function CardDeducao({ titulo, valor, bruto, detalhe }: { titulo: string; valor: number; bruto: number; detalhe?: string }) {
  const partes = [bruto > 0 ? `${percentualDoBruto(valor, bruto)} do bruto` : null, detalhe ?? null].filter(Boolean)
  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">{titulo}</CardTitle></CardHeader>
      <CardContent>
        <p className="text-2xl font-bold text-destructive">-{brl(valor)}</p>
        {partes.length > 0 && <p className="text-xs text-muted-foreground">{partes.join(' · ')}</p>}
      </CardContent>
    </Card>
  )
}

/** "41 PIX conciliados", "1 PIX conciliado". */
export const pixConciliados = (n: number) => `${n} PIX ${n === 1 ? 'conciliado' : 'conciliados'}`
