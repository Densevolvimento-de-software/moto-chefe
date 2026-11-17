import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { montarDom } from '@/test/montar-dom'
import { StatusCards } from './status-cards'

const { desmontar } = montarDom()
after(desmontar)

const CONTAGEM = { total: 1, caixa: 2, montada: 3, disponivel: 4, reservada: 5, em_garantia: 6, aguardando_nf: 7 }

function grade(emTransporte: number) {
  const raiz = document.createElement('div')
  raiz.innerHTML = renderToStaticMarkup(createElement(StatusCards, { counts: { ...CONTAGEM, em_transporte: emTransporte } }))
  return raiz.firstElementChild as HTMLElement
}

// Cada card do Showroom: rótulo, número, classes do card, do ícone e do número.
const cards = (g: HTMLElement) => [...g.children].map(card => ({
  rotulo: card.querySelector('span')?.textContent,
  valor: card.querySelector('p')?.textContent,
  card: card.className,
  icone: card.querySelector('svg')?.getAttribute('class'),
  numero: card.querySelector('p')?.className,
}))

// Rótulos, ordem, ícones e cores de hoje (#941: a lista única de status não muda a tela).
const CARDS_DE_HOJE = [
  { rotulo: 'Total', valor: '1', card: 'rounded-xl border border-border bg-muted px-3 py-3', icone: 'lucide lucide-layers lucide-layers-3 text-muted-foreground', numero: 'text-2xl font-bold text-foreground' },
  { rotulo: 'Caixa', valor: '2', card: 'rounded-xl border border-border bg-muted px-3 py-3', icone: 'lucide lucide-package text-muted-foreground', numero: 'text-2xl font-bold text-foreground' },
  { rotulo: 'Montadas', valor: '3', card: 'rounded-xl border border-info/30 bg-info/10 px-3 py-3', icone: 'lucide lucide-zap text-info', numero: 'text-2xl font-bold text-info' },
  { rotulo: 'Disponíveis', valor: '4', card: 'rounded-xl border border-success/30 bg-success/10 px-3 py-3', icone: 'lucide lucide-circle-check lucide-check-circle-2 text-success', numero: 'text-2xl font-bold text-success' },
  { rotulo: 'Reservadas', valor: '5', card: 'rounded-xl border border-warning/30 bg-warning/10 px-3 py-3', icone: 'lucide lucide-clock text-warning', numero: 'text-2xl font-bold text-warning' },
  { rotulo: 'Garantia', valor: '6', card: 'rounded-xl border border-warning/30 bg-warning/10 px-3 py-3', icone: 'lucide lucide-shield-exclamation-point lucide-shield-alert text-warning', numero: 'text-2xl font-bold text-warning' },
  { rotulo: 'Ag. NF', valor: '7', card: 'rounded-xl border border-info/30 bg-info/10 px-3 py-3', icone: 'lucide lucide-file-check text-info', numero: 'text-2xl font-bold text-info' },
]

test('sem moto em transporte no recorte: os 7 cards de hoje, sem o card Em transporte, 7 por linha no desktop', () => {
  const g = grade(0)
  assert.deepEqual(cards(g), CARDS_DE_HOJE)
  assert.equal(g.className, 'grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-7 gap-3')
})

// Card tracejado do protótipo do #7 e ordem do caminho da moto (decisão do Luis no #12): logo depois do Total.
test('com moto em transporte no recorte: card Em transporte tracejado em info depois do Total, 8 por linha no desktop', () => {
  const g = grade(3)
  const [total, ...resto] = CARDS_DE_HOJE
  assert.deepEqual(cards(g), [
    total,
    { rotulo: 'Em transporte', valor: '3', card: 'rounded-xl border border-dashed border-info bg-card px-3 py-3', icone: 'lucide lucide-truck text-info', numero: 'text-2xl font-bold text-info' },
    ...resto,
  ])
  assert.equal(g.className, 'grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-8 gap-3')
})

// Layout do card (decisão do Luis no #12): o ícone dividia a linha com o rótulo e "Em transporte" quebrava em 1280/1366.
// O teste lê o DOM: rótulo sem quebra e sozinho na 1ª linha, número e ícone na 2ª. Não mede altura em px.
test('todo card: rótulo sozinho na 1ª linha e sem quebra; número e ícone juntos na 2ª', () => {
  for (const emTransporte of [0, 3]) {
    for (const card of grade(emTransporte).children) {
      const [linhaDoRotulo, linhaDoNumero, ...sobra] = [...card.children]
      const nome = card.querySelector('span')?.textContent
      assert.equal(sobra.length, 0, `${nome}: só 2 linhas`)
      assert.equal(linhaDoRotulo.tagName, 'SPAN', `${nome}: 1ª linha é só o rótulo`)
      assert.ok(linhaDoRotulo.classList.contains('whitespace-nowrap'), `${nome}: rótulo não quebra`)
      assert.ok(linhaDoNumero.querySelector('p') && linhaDoNumero.querySelector('svg'), `${nome}: número e ícone na 2ª linha`)
    }
  }
})
