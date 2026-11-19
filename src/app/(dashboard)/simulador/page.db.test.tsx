// Teste de banco da página do Simulador (#91): cada Conta recebe só o custo do PIX do próprio grupo.
// O componente de cliente é trocado por um que só escreve a taxa recebida: o rodapé só aparece depois
// de escolher o modelo, o que a renderização no servidor não faz.
import { after, before, mock, test } from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { sql } from 'drizzle-orm'
import { paginaPorConta } from '@/test/pagina-por-conta'
import type { Base } from '@/test/semear-conta'

const pagina = paginaPorConta('SI091')
const clienteMock = mock.module('./components/simulador-client', { namedExports: {
  SimuladorClient: ({ taxas }: { taxas: { custoPixTaxa: number } }) => createElement('output', { id: 'custo-pix' }, String(taxas.custoPixTaxa)),
} })
after(() => clienteMock.restore())

let Pagina: typeof import('./page')['default']
const contas: Base[] = []

before(async () => {
  ;({ default: Pagina } = await import('./page'))
  contas.push(await pagina.conta('A', '00000000009101'), await pagina.conta('B', '00000000009102'), await pagina.conta('C', '00000000009103'))
  const [a, b] = contas
  await pagina.db().execute(sql`insert into configuracao_taxas (grupo_id, custo_pix_taxa) values (${a.grupoId}, 0.002), (${b.grupoId}, 0.005)`)
})

const custoQueAPaginaPassa = async (base: Base, papel: 'admin_socio' | 'vendedor', rotulo: string) =>
  /<output id="custo-pix">([^<]*)<\/output>/.exec(await pagina.renderizarComo(Pagina, base, papel, rotulo))?.[1]

test('sócio e vendedor de cada Conta recebem só o custo do PIX do próprio grupo', async () => {
  const [a, b] = contas
  assert.equal(await custoQueAPaginaPassa(b, 'admin_socio', 'socio-b'), '0.005')
  assert.equal(await custoQueAPaginaPassa(a, 'admin_socio', 'socio-a'), '0.002')
  assert.equal(await custoQueAPaginaPassa(b, 'vendedor', 'vendedor-b'), '0.005')
  assert.equal(await custoQueAPaginaPassa(a, 'vendedor', 'vendedor-a'), '0.002')
})

test('grupo sem linha de taxas recebe 0', async () => {
  assert.equal(await custoQueAPaginaPassa(contas[2], 'admin_socio', 'socio-c'), '0')
})
