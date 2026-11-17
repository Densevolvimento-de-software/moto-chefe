// Lista única dos status da moto (#941): o resto (Editar moto, filtro e cards do Showroom, selo de
// status, rótulos) deriva daqui. Status é lista igual para qualquer Conta (AGENTS.md, "Multi-grupo").
import { CheckCircle2, Package, ShieldAlert, Truck, XCircle, Zap, type LucideIcon } from 'lucide-react'

/** Selo da lista e da transferência: ícone e classes do texto e do ícone. */
type Selo = { icone: LucideIcon; texto: string; classeIcone?: string }

/** Card do Showroom: tem rótulo no plural e paleta própria, diferente do selo. */
type Card = { rotulo: string; icone: LucideIcon; numero: string; fundo: string; borda: string; corIcone: string }

/** Status em que a moto ainda é estoque: os que o Editar moto e o filtro do Showroom oferecem. */
export const STATUS_DE_ESTOQUE = [
  {
    // Variante 2 do protótipo (#7): selo em pílula e card tracejado, os dois na cor info.
    valor: 'em_transporte', rotulo: 'Em transporte',
    selo: { icone: Truck, texto: 'w-fit rounded-full border border-info/30 bg-info/10 px-2 py-0.5 text-info font-medium' },
    card: { rotulo: 'Em transporte', icone: Truck, numero: 'text-info', fundo: 'bg-card', borda: 'border-dashed border-info', corIcone: 'text-info' },
  },
  {
    valor: 'caixa', rotulo: 'Caixa',
    selo: { icone: Package, texto: 'text-muted-foreground' },
    card: { rotulo: 'Caixa', icone: Package, numero: 'text-foreground', fundo: 'bg-muted', borda: 'border-border', corIcone: 'text-muted-foreground' },
  },
  {
    valor: 'montada', rotulo: 'Montada',
    selo: { icone: Zap, texto: 'text-success font-medium', classeIcone: 'fill-success text-success' },
    card: { rotulo: 'Montadas', icone: Zap, numero: 'text-info', fundo: 'bg-info/10', borda: 'border-info/30', corIcone: 'text-info' },
  },
  {
    valor: 'em_garantia', rotulo: 'Garantia',
    selo: { icone: XCircle, texto: 'text-destructive font-medium', classeIcone: 'fill-destructive/10' },
    card: { rotulo: 'Garantia', icone: ShieldAlert, numero: 'text-warning', fundo: 'bg-warning/10', borda: 'border-warning/30', corIcone: 'text-warning' },
  },
] as const satisfies readonly { valor: string; rotulo: string; selo: Selo; card: Card }[]

/** Todos os status que a tela mostra: os de estoque e a vendida. */
export const STATUS_MOTO: readonly { valor: string; rotulo: string; selo: Selo }[] = [
  ...STATUS_DE_ESTOQUE,
  { valor: 'vendida', rotulo: 'Vendida', selo: { icone: CheckCircle2, texto: 'text-primary-text font-medium', classeIcone: 'text-primary-text' } },
]

export type StatusDeEstoque = (typeof STATUS_DE_ESTOQUE)[number]['valor']

// Valores antigos do enum moto_status, sem motos hoje, que ainda podem aparecer no histórico.
const ROTULOS_LEGADOS: Record<string, string> = { faturada: 'Caixa', disponivel: 'Disponível', reservada: 'Reservada' }

const ROTULOS: Record<string, string> = {
  ...ROTULOS_LEGADOS,
  ...Object.fromEntries(STATUS_MOTO.map(s => [s.valor, s.rotulo])),
}

/** Rótulo de qualquer valor de status, inclusive os legados; valor desconhecido sai como veio. */
export function rotuloDoStatus(valor: string): string {
  return ROTULOS[valor] ?? valor
}

export function statusDaLista(valor: string) {
  return STATUS_MOTO.find(s => s.valor === valor) ?? null
}

const CARDS = Object.fromEntries(STATUS_DE_ESTOQUE.map(s => [s.valor, s.card])) as Record<StatusDeEstoque, Card>

export function cardDoStatus(valor: StatusDeEstoque): Card {
  return CARDS[valor]
}
