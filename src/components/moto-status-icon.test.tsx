import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MotoStatusIcon } from './moto-status-icon'

const selo = (status: string) => renderToStaticMarkup(createElement(MotoStatusIcon, { status }))
const texto = (html: string) => html.replace(/<[^>]+>/g, '')

// Texto, cor e ícone que a lista e a transferência mostram hoje (#941: a lista única não muda a tela).
test('selo de cada status: texto, cor e ícone de hoje', () => {
  const casos = [
    { status: 'caixa', texto: 'Caixa', span: 'flex items-center gap-1 text-muted-foreground text-sm', svg: 'lucide lucide-package' },
    { status: 'montada', texto: 'Montada', span: 'flex items-center gap-1 text-success font-medium text-sm', svg: 'lucide lucide-zap fill-success text-success' },
    { status: 'em_garantia', texto: 'Garantia', span: 'flex items-center gap-1 text-destructive font-medium text-sm', svg: 'lucide lucide-circle-x lucide-x-circle fill-destructive/10' },
    { status: 'vendida', texto: 'Vendida', span: 'flex items-center gap-1 text-primary-text font-medium text-sm', svg: 'lucide lucide-circle-check lucide-check-circle-2 text-primary-text' },
  ]
  for (const c of casos) {
    const html = selo(c.status)
    assert.equal(texto(html), c.texto, c.status)
    assert.equal(html.match(/^<span class="([^"]*)"/)?.[1], c.span, `${c.status}: classes do texto`)
    assert.equal(html.match(/<svg[^>]*class="([^"]*)"/)?.[1], c.svg, `${c.status}: ícone`)
  }
})

test('status fora da lista não vira "Caixa": mostra o próprio valor, sem o ícone da caixa', () => {
  const html = selo('xyz')
  assert.equal(texto(html), 'xyz')
  assert.ok(!html.includes('lucide-package'))
})
