// Teste de banco da página da Precificação: cada Conta vê só o custo do PIX do próprio grupo (#89) e só as
// lojas ativas do próprio grupo no bloco da entrada mínima da reserva (#283).
import { before, test } from 'node:test'
import assert from 'node:assert/strict'
import { sql } from 'drizzle-orm'
import { paginaPorConta } from '@/test/pagina-por-conta'
import { semearLoja, type Base } from '@/test/semear-conta'
import { ENTRADA_MINIMA_PADRAO_PCT } from '@/lib/entrada-minima-reserva'

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

const campoDaLoja = (html: string, loja: string) => {
  const campo = new RegExp(`<input[^>]*aria-label="Entrada mínima da loja ${loja}"[^>]*>`).exec(html)?.[0]
  return campo && /\bvalue="([^"]*)"/.exec(campo)?.[1]
}

test('o bloco da entrada mínima lista só as lojas ativas do grupo, com a porcentagem de cada uma', async () => {
  const d = await pagina.conta('D', '00000000008904')
  const e = await pagina.conta('E', '00000000008905')
  const exec = pagina.db().execute.bind(pagina.db())
  const centro = await semearLoja(pagina.db(), d.grupoId, 'PP089 Loja Centro D')
  await semearLoja(pagina.db(), d.grupoId, 'PP089 Loja Norte D')
  const fechada = await semearLoja(pagina.db(), d.grupoId, 'PP089 Loja Fechada D')
  await semearLoja(pagina.db(), e.grupoId, 'PP089 Loja Centro E')
  await exec(sql`update lojas set entrada_minima_reserva_pct = 20 where id = ${centro}`)
  await exec(sql`update lojas set ativa = false, entrada_minima_reserva_pct = 5 where id = ${fechada}`)
  const html = await pagina.renderizarComo(Pagina, d, 'admin_socio', 'socio-d')
  assert.equal(campoDaLoja(html, 'PP089 Loja Centro D'), '20')
  assert.equal(campoDaLoja(html, 'PP089 Loja Norte D'), '30')
  assert.equal(campoDaLoja(html, 'PP089 Loja Fechada D'), undefined)
  assert.equal(campoDaLoja(html, 'PP089 Loja Centro E'), undefined)
})

test('o padrão da loja no banco é o da constante que a tela usa no rodapé', async () => {
  const [coluna] = ((await pagina.db().execute(sql`select column_default from information_schema.columns
    where table_name = 'lojas' and column_name = 'entrada_minima_reserva_pct'`)) as unknown as { rows: { column_default: string }[] }).rows
  assert.equal(Number(coluna.column_default), ENTRADA_MINIMA_PADRAO_PCT)
})
