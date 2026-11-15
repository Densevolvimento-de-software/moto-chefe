// Teste de banco: marcar comunicado como lido só grava para comunicado do grupo ativo de quem pede.
// Pedido forjado com id de outra Conta ou inexistente: mesma resposta e nada gravado (#939).
// Roda no Postgres descartável do CI. Local: `npm run test:db:local`.
import { after, before, mock, test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { semearContaBase, semearUsuario, type Base } from '@/test/semear-conta'

const url = process.env.TEST_DATABASE_URL
if (!url) throw new Error('TEST_DATABASE_URL não definida — este teste só roda num Postgres descartável')
if (!['localhost', '127.0.0.1'].includes(new URL(url).hostname)) {
  throw new Error('TEST_DATABASE_URL precisa ser loopback (Postgres descartável)')
}
process.env.DATABASE_URL = url

let sessao: Record<string, unknown> = {}
const mocks = [
  mock.module('@/lib/auth', { namedExports: { getUsuarioLogado: async () => sessao } }),
  mock.module('next/headers', { namedExports: { cookies: async () => ({ get: () => undefined }) } }),
  mock.module('next/cache', { namedExports: { revalidatePath: () => {} } }),
]

type Db = typeof import('@/lib/db')
let db: Db['db']
let execRows: Db['execRows']
let marcarComoLidoAction: typeof import('./actions')['marcarComoLidoAction']
const s = { contaA: '', grupoA: '', contaB: '', grupoB: '', comunicadoA: '', comunicadoB: '' }
const usuarios = { vendedorA: '', socioA: '', vendedorSemLoja: '' }
let a: Base

const semearComunicado = async (grupoId: string, titulo: string) =>
  (await execRows(sql`insert into comunicados (grupo_id, titulo, conteudo)
    values (${grupoId}, ${titulo}, 'Aviso de teste') returning id`))[0].id as string

const lidosPor = async (usuarioId: string) => (await execRows(sql`
  select comunicado_id from comunicados_lidos where usuario_id = ${usuarioId}`)).map(l => l.comunicado_id as string)

const comoVendedorA = () => {
  sessao = { id: usuarios.vendedorA, papel: 'vendedor', lojaId: a.lojaId, gruposAcesso: [], contaId: a.contaId, grupoLiberado: null }
}

before(async () => {
  ;({ db, execRows } = await import('@/lib/db'))
  ;({ marcarComoLidoAction } = await import('./actions'))
  // A action usa o db global: a semente é gravada e apagada no after.
  a = await semearContaBase(db, { prefixo: 'CL939', nome: 'A', cnpj: '00000000093901' })
  const b = await semearContaBase(db, { prefixo: 'CL939', nome: 'B', cnpj: '00000000093902' })
  Object.assign(s, { contaA: a.contaId, grupoA: a.grupoId, contaB: b.contaId, grupoB: b.grupoId })
  usuarios.vendedorA = await semearUsuario(db, a, { papel: 'vendedor' })
  usuarios.socioA = await semearUsuario(db, a, { papel: 'admin_socio', rotulo: 'socio', semLoja: true, comGrupo: true })
  usuarios.vendedorSemLoja = await semearUsuario(db, a, { papel: 'vendedor', rotulo: 'semloja', semLoja: true })
  s.comunicadoA = await semearComunicado(a.grupoId, 'Comunicado da Conta A')
  s.comunicadoB = await semearComunicado(b.grupoId, 'Comunicado da Conta B')
})

after(async () => {
  // Só o que a semente chegou a criar: um before que falhou no meio não esconde o erro dele.
  const grupos = sql.param([s.grupoA, s.grupoB].filter(Boolean))
  const contas = sql.param([s.contaA, s.contaB].filter(Boolean))
  try {
    await db.execute(sql`delete from comunicados where grupo_id = any(${grupos}::uuid[])`)
    await db.execute(sql`delete from usuarios where email like '%-cl939-%'`)
    await db.execute(sql`delete from lojas where grupo_id = any(${grupos}::uuid[])`)
    await db.execute(sql`delete from grupos where id = any(${grupos}::uuid[])`)
    await db.execute(sql`delete from contas where id = any(${contas}::uuid[])`)
  } finally {
    for (const m of mocks) m.restore()
    await (globalThis as { __pgPool?: { end(): Promise<void> } }).__pgPool?.end()
  }
})

test('vendedor marca como lido o comunicado do próprio grupo, uma vez só mesmo clicando duas', async () => {
  comoVendedorA()
  await marcarComoLidoAction(s.comunicadoA)
  await marcarComoLidoAction(s.comunicadoA)
  assert.deepEqual(await lidosPor(usuarios.vendedorA), [s.comunicadoA])
})

test('pedido forjado com comunicado de outra Conta e com id inexistente: mesma resposta e nada gravado', async () => {
  comoVendedorA()
  const respostas = await Promise.allSettled([marcarComoLidoAction(s.comunicadoB), marcarComoLidoAction(randomUUID())])
  assert.deepEqual(respostas, [{ status: 'fulfilled', value: undefined }, { status: 'fulfilled', value: undefined }])
  assert.deepEqual(await lidosPor(usuarios.vendedorA), [s.comunicadoA])
})

test('sócio sem loja marca o comunicado do grupo que ele acessa, e não o da outra Conta', async () => {
  sessao = { id: usuarios.socioA, papel: 'admin_socio', lojaId: null, gruposAcesso: [a.grupoId], contaId: a.contaId, grupoLiberado: null }
  await marcarComoLidoAction(s.comunicadoA)
  await marcarComoLidoAction(s.comunicadoB)
  assert.deepEqual(await lidosPor(usuarios.socioA), [s.comunicadoA])
})

test('login sem grupo (vendedor sem loja) é recusado e não grava nem o comunicado da própria Conta', async () => {
  sessao = { id: usuarios.vendedorSemLoja, papel: 'vendedor', lojaId: null, gruposAcesso: [], contaId: a.contaId, grupoLiberado: null }
  await assert.rejects(marcarComoLidoAction(s.comunicadoA), /Usuário sem loja associada/)
  assert.deepEqual(await lidosPor(usuarios.vendedorSemLoja), [])
})
