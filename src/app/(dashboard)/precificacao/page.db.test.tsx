// Teste de banco da página da Precificação (#89): cada Conta vê só o custo do PIX do próprio grupo.
// Só a fronteira de fora é simulada (sessão, cookies, redirect); grupo ativo e consulta rodam de verdade.
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
]

type Db = typeof import('@/lib/db')
let db: Db['db']
let Pagina: typeof import('./page')['default']
const contas: Base[] = []

before(async () => {
  ;({ db } = await import('@/lib/db'))
  ;({ default: Pagina } = await import('./page'))
  const a = await semearContaBase(db, { prefixo: 'PP089', nome: 'A', cnpj: '00000000008901' })
  const b = await semearContaBase(db, { prefixo: 'PP089', nome: 'B', cnpj: '00000000008902' })
  contas.push(a, b)
  await db.execute(sql`insert into configuracao_taxas (grupo_id, custo_pix_taxa) values (${a.grupoId}, 0.002), (${b.grupoId}, 0.005)`)
})

after(async () => {
  const grupos = sql.param(contas.map(c => c.grupoId))
  const ids = sql.param(contas.map(c => c.contaId))
  try {
    await db.execute(sql`delete from configuracao_taxas where grupo_id = any(${grupos}::uuid[])`)
    await db.execute(sql`delete from usuarios where email like '%-pp089-%'`)
    await db.execute(sql`delete from lojas where grupo_id = any(${grupos}::uuid[])`)
    await db.execute(sql`delete from grupos where id = any(${grupos}::uuid[])`)
    await db.execute(sql`delete from contas where id = any(${ids}::uuid[])`)
  } finally {
    for (const m of mocks) m.restore()
    await (globalThis as { __pgPool?: { end(): Promise<void> } }).__pgPool?.end()
  }
})

async function abrirComoSocio(base: Base, rotulo: string) {
  const id = await semearUsuario(db, base, { papel: 'admin_socio', rotulo, semLoja: true, comGrupo: true })
  sessao = { id, papel: 'admin_socio', lojaId: null, gruposAcesso: [base.grupoId], contaId: base.contaId, grupoLiberado: null }
  const html = renderToStaticMarkup(createElement('div', null, await Pagina()))
  const campo = /<input[^>]*\bid="custo-pix"[^>]*>/.exec(html)?.[0] ?? ''
  return /\bvalue="([^"]*)"/.exec(campo)?.[1]
}

test('o sócio de cada Conta vê só o custo do PIX do próprio grupo', async () => {
  const [a, b] = contas
  assert.equal(await abrirComoSocio(b, 'socio-b'), '0.5')
  assert.equal(await abrirComoSocio(a, 'socio-a'), '0.2')
})
