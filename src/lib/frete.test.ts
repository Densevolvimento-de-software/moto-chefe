// O pedido ao serviço de geocodificação se identifica como o MOVA, não com o e-mail de um cliente (#149).
import { afterEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { geocodificarCep } from './frete'
import { CONTRATADA } from './mova-empresa'

const fetchOriginal = globalThis.fetch
afterEach(() => { globalThis.fetch = fetchOriginal })

test('a identificação enviada ao serviço de geocodificação é a do MOVA', async () => {
  const agentes: string[] = []
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    const texto = String(url)
    if (texto.includes('viacep')) return new Response(JSON.stringify({ localidade: 'Cidade', uf: 'MG' }))
    agentes.push(new Headers(init?.headers).get('User-Agent') ?? '')
    return new Response(JSON.stringify([{ lat: '-22.2', lon: '-45.9' }]))
  }) as typeof fetch
  await geocodificarCep('37550000')
  assert.deepEqual(agentes, [`${CONTRATADA.marca}-Simulador/1.0 (${CONTRATADA.email})`])
})
