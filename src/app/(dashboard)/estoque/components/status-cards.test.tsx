import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { StatusCards } from './status-cards'

// Cada card do Showroom: rótulo, número, classes do card, do ícone e do número.
function cards(html: string) {
  return [...html.matchAll(/<div class="rounded-xl ([^"]*)">.*?<span[^>]*>([^<]*)<\/span><svg[^>]*class="([^"]*)".*?<p class="([^"]*)">([^<]*)<\/p>/g)]
    .map(([, card, rotulo, icone, numero, valor]) => ({ rotulo, valor, card, icone, numero }))
}

// Rótulos, ordem, ícones e cores de hoje (#941: a lista única de status não muda a tela).
test('cards do Showroom: rótulos, ordem, números, ícones e cores de hoje', () => {
  const html = renderToStaticMarkup(createElement(StatusCards, {
    counts: { total: 1, caixa: 2, montada: 3, disponivel: 4, reservada: 5, em_garantia: 6, aguardando_nf: 7 },
  }))
  assert.deepEqual(cards(html), [
    { rotulo: 'Total', valor: '1', card: 'border border-border bg-muted px-4 py-3', icone: 'lucide lucide-layers lucide-layers-3 text-muted-foreground', numero: 'text-2xl font-bold text-foreground' },
    { rotulo: 'Caixa', valor: '2', card: 'border border-border bg-muted px-4 py-3', icone: 'lucide lucide-package text-muted-foreground', numero: 'text-2xl font-bold text-foreground' },
    { rotulo: 'Montadas', valor: '3', card: 'border border-info/30 bg-info/10 px-4 py-3', icone: 'lucide lucide-zap text-info', numero: 'text-2xl font-bold text-info' },
    { rotulo: 'Disponíveis', valor: '4', card: 'border border-success/30 bg-success/10 px-4 py-3', icone: 'lucide lucide-circle-check lucide-check-circle-2 text-success', numero: 'text-2xl font-bold text-success' },
    { rotulo: 'Reservadas', valor: '5', card: 'border border-warning/30 bg-warning/10 px-4 py-3', icone: 'lucide lucide-clock text-warning', numero: 'text-2xl font-bold text-warning' },
    { rotulo: 'Garantia', valor: '6', card: 'border border-warning/30 bg-warning/10 px-4 py-3', icone: 'lucide lucide-shield-exclamation-point lucide-shield-alert text-warning', numero: 'text-2xl font-bold text-warning' },
    { rotulo: 'Ag. NF', valor: '7', card: 'border border-info/30 bg-info/10 px-4 py-3', icone: 'lucide lucide-file-check text-info', numero: 'text-2xl font-bold text-info' },
  ])
})
