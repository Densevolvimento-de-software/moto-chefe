// Botão Garantia (#9): com motivo de bloqueio, fica desabilitado e mostra o motivo (no title e, com rótulo,
// também escrito ao lado, porque no celular não há title); sem motivo, abre normalmente.
import { createElement } from 'react'
import test, { after, mock } from 'node:test'
import assert from 'node:assert/strict'
import { renderToStaticMarkup } from 'react-dom/server'

// A action grava no banco; o teste só desenha o botão.
const mocks = [mock.module('../../garantias/actions', { namedExports: { abrirGarantiaAction: async () => ({ ok: true }) } })]
after(() => mocks.forEach(m => m.restore()))

const MOTIVO = 'Moto ainda em transporte. Garantia só depois da chegada.'

async function desenhar(props: { showLabel?: boolean; motivoBloqueio?: string | null }) {
  const { GarantiaButton } = await import('./garantia-button')
  const html = renderToStaticMarkup(createElement(GarantiaButton, { motoId: 'm1', descricao: 'JET', ...props }))
  const botao = html.match(/<button[^>]*>/)![0]
  return { botao, texto: html.replace(/<[^>]+>/g, '') }
}

test('com rótulo e motivo: botão desabilitado, motivo no title e escrito ao lado', async () => {
  const { botao, texto } = await desenhar({ showLabel: true, motivoBloqueio: MOTIVO })
  assert.match(botao, / disabled=""/)
  assert.match(botao, new RegExp(`title="${MOTIVO}"`))
  assert.equal(texto, 'Garantia' + MOTIVO)
})

test('só o ícone, com motivo: desabilitado, motivo no title, sem texto ao lado', async () => {
  const { botao, texto } = await desenhar({ motivoBloqueio: MOTIVO })
  assert.match(botao, / disabled=""/)
  assert.match(botao, new RegExp(`title="${MOTIVO}"`))
  assert.equal(texto, '')
})

test('sem motivo: botão habilitado, "Abrir Garantia"', async () => {
  const { botao } = await desenhar({ showLabel: true, motivoBloqueio: null })
  assert.doesNotMatch(botao, / disabled=""/)
  assert.match(botao, /title="Abrir Garantia"/)
})
