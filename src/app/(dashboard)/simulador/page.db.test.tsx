// Teste de banco da página do Simulador (#91): cada Conta recebe só o custo do PIX do próprio grupo.
// A consulta roda de verdade; a fronteira de fora (sessão, cookies, redirect) é simulada, e o componente de
// cliente é trocado por um que só escreve a taxa recebida, porque o rodapé só aparece depois de escolher o modelo.
import { after, before, mock, test } from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { sql } from 'drizzle-orm'
import { semearContaBase, semearUsuario, type Base } from '@/test/semear-conta'

const url = process.env.TEST_DATABASE_URL
if (!url || !['localhost', '127.0.0.1'].includes(new URL(url).hostname)) throw new Error('Use somente Postgres descartável local')
process.env.DATABASE_URL = url

let sessao: Record<string, unknown> = {}
const mocks = [
  mock.module('@/lib/auth', { namedExports: { getUsuarioLogado: async () => sessao } }),
  mock.module('next/headers', { namedExports: { cookies: async () => ({ get: () => undefined }) } }),
  mock.module('next/navigation', { namedExports: { redirect: (destino: string) => { throw new Error(`redirect ${destino}`) } } }),
  mock.module('./components/simulador-client', { namedExports: {
    SimuladorClient: ({ taxas }: { taxas: { custoPixTaxa: number } }) => createElement('output', { id: 'custo-pix' }, String(taxas.custoPixTaxa)),
  } }),
]

type Db = typeof import('@/lib/db')
let db: Db['db']
let Pagina: typeof import('./page')['default']
const contas: Base[] = []

before(async () => {
  ;({ db } = await import('@/lib/db'))
  ;({ default: Pagina } = await import('./page'))
  const a = await semearContaBase(db, { prefixo: 'SI091', nome: 'A', cnpj: '00000000009101' })
  const b = await semearContaBase(db, { prefixo: 'SI091', nome: 'B', cnpj: '00000000009102' })
  const c = await semearContaBase(db, { prefixo: 'SI091', nome: 'C', cnpj: '00000000009103' })
  contas.push(a, b, c)
  await db.execute(sql`insert into configuracao_taxas (grupo_id, custo_pix_taxa) values (${a.grupoId}, 0.002), (${b.grupoId}, 0.005)`)
})

after(async () => {
  const grupos = sql.param(contas.map(c => c.grupoId))
  const ids = sql.param(contas.map(c => c.contaId))
  try {
    await db.execute(sql`delete from configuracao_taxas where grupo_id = any(${grupos}::uuid[])`)
    await db.execute(sql`delete from usuarios where email like '%-si091-%'`)
    await db.execute(sql`delete from lojas where grupo_id = any(${grupos}::uuid[])`)
    await db.execute(sql`delete from grupos where id = any(${grupos}::uuid[])`)
    await db.execute(sql`delete from contas where id = any(${ids}::uuid[])`)
  } finally {
    for (const m of mocks) m.restore()
    await (globalThis as { __pgPool?: { end(): Promise<void> } }).__pgPool?.end()
  }
})

async function custoQueAPaginaPassa(base: Base, rotulo: string) {
  const id = await semearUsuario(db, base, { papel: 'admin_socio', rotulo, semLoja: true, comGrupo: true })
  sessao = { id, papel: 'admin_socio', lojaId: null, gruposAcesso: [base.grupoId], contaId: base.contaId, grupoLiberado: null }
  const html = renderToStaticMarkup(createElement('div', null, await Pagina()))
  return /<output id="custo-pix">([^<]*)<\/output>/.exec(html)?.[1]
}

test('cada Conta recebe só o custo do PIX do próprio grupo', async () => {
  const [a, b] = contas
  assert.equal(await custoQueAPaginaPassa(b, 'socio-b'), '0.005')
  assert.equal(await custoQueAPaginaPassa(a, 'socio-a'), '0.002')
})

test('grupo sem linha de taxas recebe 0: sem rodapé', async () => {
  assert.equal(await custoQueAPaginaPassa(contas[2], 'socio-c'), '0')
})
