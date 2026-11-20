// Teste de banco da página da Precificação (#89): cada Conta vê só o custo do PIX do próprio grupo.
import { before, test } from 'node:test'
import assert from 'node:assert/strict'
import { sql } from 'drizzle-orm'
import { paginaPorConta } from '@/test/pagina-por-conta'
import type { Base } from '@/test/semear-conta'

const pagina = paginaPorConta('PP089')
let Pagina: typeof import('./page')['default']
const contas: Base[] = []

before(async () => {
  ;({ default: Pagina } = await import('./page'))
  // C não tem linha em configuracao_taxas.
  contas.push(await pagina.conta('A', '00000000008901'), await pagina.conta('B', '00000000008902'), await pagina.conta('C', '00000000008903'))
  const [a, b] = contas
  await pagina.db().execute(sql`insert into configuracao_taxas (grupo_id, custo_pix_taxa) values (${a.grupoId}, 0.002), (${b.grupoId}, 0.005)`)
})

async function abrirComoSocio(base: Base, rotulo: string) {
  const html = await pagina.renderizarComo(Pagina, base, 'admin_socio', rotulo)
  const campo = /<input[^>]*\bid="custo-pix"[^>]*>/.exec(html)?.[0] ?? ''
  return /\bvalue="([^"]*)"/.exec(campo)?.[1]
}

test('o sócio de cada Conta vê só o custo do PIX do próprio grupo', async () => {
  const [a, b] = contas
  assert.equal(await abrirComoSocio(b, 'socio-b'), '0,5')
  assert.equal(await abrirComoSocio(a, 'socio-a'), '0,2')
})

test('grupo sem taxas cadastradas abre o custo do PIX vazio, como 0', async () => {
  assert.equal(await abrirComoSocio(contas[2], 'socio-c'), '')
})
