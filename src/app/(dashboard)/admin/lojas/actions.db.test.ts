// Teste de banco: Postgres descartável. Cadastro comum de loja (#321): criar e editar não gravam a marcação
// "Loja MotoChefe", nem com o campo a mais no formulário. Fronteira mockada: sessão, next/cache e geocodificação.
import { after, before, mock, test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { semearContaBase, semearLoja, semearUsuario } from '@/test/semear-conta'

const url = process.env.TEST_DATABASE_URL
if (!url) throw new Error('TEST_DATABASE_URL não definida — este teste só roda num Postgres descartável')
if (!['localhost', '127.0.0.1'].includes(new URL(url).hostname)) {
  throw new Error('TEST_DATABASE_URL precisa ser loopback (Postgres descartável)')
}
process.env.DATABASE_URL = url

// Quem está logado: o id do usuário no token (fronteira do Supabase). O papel vem do banco, como em produção.
let logadoComo: string | null = null
mock.module('@/lib/supabase/server', { namedExports: {
  createClient: async () => ({ auth: { getClaims: async () => ({
    data: logadoComo ? { claims: { sub: logadoComo, app_metadata: {} } } : null,
  }) } }),
} })
mock.module('next/cache', { namedExports: { revalidatePath: () => {}, revalidateTag: () => {} } })
// Sem rede: a geocodificação do CEP não entra no teste.
mock.module('@/lib/frete', { namedExports: {
  geoDaLoja: async () => ({ cep: null, latitude: null, longitude: null }),
} })

let actions: typeof import('./actions')
let db: typeof import('@/lib/db')['db']
let execRows: typeof import('@/lib/db')['execRows']

before(async () => {
  ;({ db, execRows } = await import('@/lib/db'))
  actions = await import('./actions')
})
after(async () => { await (globalThis as { __pgPool?: { end(): Promise<void> } }).__pgPool?.end() })

const cnpj = () => String(Math.floor(Math.random() * 1e14)).padStart(14, '0')
const marcadaDaLoja = async (id: string) =>
  (await execRows(sql`select loja_motochefe from lojas where id = ${id}`))[0].loja_motochefe
const formulario = (campos: Record<string, string>) => {
  const f = new FormData()
  for (const [k, v] of Object.entries(campos)) f.set(k, v)
  return f
}

test('editar loja não altera a marcação, nem com lojaMotochefe no formulário', async () => {
  logadoComo = await semearUsuario(db, await semearContaBase(db, { prefixo: 'MCL0', nome: 'Adm', cnpj: cnpj() }), { papel: 'admin_geral', rotulo: 'admin-lojas', semLoja: true })
  const conta = await semearContaBase(db, { prefixo: 'MCL1', nome: 'A', cnpj: cnpj() })
  const outra = await semearLoja(db, conta.grupoId, `Loja MCL1 Outra ${randomUUID()}`)
  await db.execute(sql`update lojas set loja_motochefe = true where id = ${conta.lojaId}`)

  await actions.editarLojaAction(conta.lojaId, formulario({ nome: 'Loja MCL1 A', cidade: 'C', endereco: 'R', lojaMotochefe: 'false' }))
  await actions.editarLojaAction(outra, formulario({ nome: 'Loja MCL1 Outra', cidade: 'C', endereco: 'R', lojaMotochefe: 'true' }))

  assert.equal(await marcadaDaLoja(conta.lojaId), true, 'loja marcada não pode ser desmarcada pelo formulário')
  assert.equal(await marcadaDaLoja(outra), false, 'loja desmarcada não pode ser marcada pelo formulário')
})

test('criar loja nova nasce desmarcada, mesmo com lojaMotochefe no formulário', async () => {
  logadoComo = await semearUsuario(db, await semearContaBase(db, { prefixo: 'MCL0b', nome: 'Adm', cnpj: cnpj() }), { papel: 'admin_geral', rotulo: 'admin-lojas2', semLoja: true })
  const conta = await semearContaBase(db, { prefixo: 'MCL2', nome: 'A', cnpj: cnpj() })
  const nome = `Loja MCL2 Nova ${randomUUID()}`
  const r = await actions.criarLojaAction(formulario({ grupoId: conta.grupoId, nome, cidade: 'C', endereco: 'R', lojaMotochefe: 'true' }))
  assert.equal(r.geocodificado, true)
  const [nova] = await execRows(sql`select loja_motochefe from lojas where nome = ${nome}`)
  assert.equal(nova.loja_motochefe, false)
})
