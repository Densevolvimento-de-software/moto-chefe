import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { brl } from '@/lib/dashboard-painel'
import { percentualDoBruto } from '@/lib/custo-pix'

/**
 * Card de dedução do Financeiro (Taxas Cartão, Tarifa PIX na maquininha, Custo PIX): o valor em vermelho e quanto é do
 * bruto; `detalhe` vem depois do percentual (ex.: "41 PIX conciliados"). Zero sai sem o sinal de menos.
 */
export function CardDeducao({ titulo, valor, bruto, detalhe }: { titulo: string; valor: number; bruto: number; detalhe?: string }) {
  const partes = [bruto > 0 ? `${percentualDoBruto(valor, bruto)} do bruto` : null, detalhe ?? null].filter(Boolean)
  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">{titulo}</CardTitle></CardHeader>
      <CardContent>
        <p className="text-2xl font-bold text-destructive">{valor > 0 ? '-' : ''}{brl(valor)}</p>
        {partes.length > 0 && <p className="text-xs text-muted-foreground">{partes.join(' · ')}</p>}
      </CardContent>
    </Card>
  )
}
