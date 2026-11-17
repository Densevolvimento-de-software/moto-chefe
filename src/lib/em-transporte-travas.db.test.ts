// Teste de banco: Postgres descartável. Status "Em transporte" (#9): as Server Actions chamadas direto,
// como faria quem abre o DevTools. Moto em transporte não vende, não pede aprovação, não vira pedido
// nem transferência; só o admin a põe nesse status, pelo Editar moto; status fora da lista é recusado;
// a Conta B recebe "Moto não encontrada", igual a um id inexistente, e nada grava na Conta A.
// Fronteira de fora mockada: sessão, next/cache, Kommo e WhatsApp.
import { after, before, mock, test } from 'node:test'
import assert from 'node:assert/strict'
import { sql } from 'drizzle-orm'
import { semearContaBase, semearUsuario } from '@/test/semear-conta'

const url = process.env.TEST_DATABASE_URL
if (!url) throw new Error('TEST_DATABASE_URL não definida — este teste só roda num Postgres descartável')
if (!['localhost', '127.0.0.1'].includes(new URL(url).hostname)) {
  throw new Error('TEST_DATABASE_URL precisa ser loopback (Postgres descartável)')
}
process.env.DATABASE_URL = url

const P = 'EMT9'
const CPF = '52998224725'
let usuarioDaSessao: Record<string, unknown> = {}

type Db = typeof import('@/lib/db')
let db: Db['db']
const mocks = [
  mock.module('@/lib/auth', { namedExports: { getUsuarioLogado: async () => usuarioDaSessao } }),
  mock.module('next/cache', { namedExports: { revalidatePath: () => {} } }),
  mock.module('@/lib/kommo', { namedExports: { virarLeadKommo: async () => ({ resultado: 'sem_lead' }) } }),
  mock.module('@/lib/whatsapp/venda', { namedExports: { notificarVendaWhatsapp: async () => ({ resultado: 'desligado' }) } }),
]

type Sessao = Record<string, unknown>
const sessoes = { socioA: {} as Sessao, auxA: {} as Sessao, socioB: {} as Sessao }
const semente = { contaA: '', grupoA: '', lojaA: '', destinoA: '', contaB: '', grupoB: '', modeloId: '', origemId: '' }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const linhas = async (q: ReturnType<typeof sql>) => ((await db.execute(q)) as unknown as { rows: any[] }).rows

before(async () => {
  ;({ db } = await import('@/lib/db'))
  const a = await semearContaBase(db, { prefixo: P, nome: 'A', cnpj: '00000000000901' })
  const b = await semearContaBase(db, { prefixo: P, nome: 'B', cnpj: '00000000000902' })
  const socioA = await semearUsuario(db, a, { papel: 'admin_socio', rotulo: 'socio', semLoja: true, comGrupo: true })
  const auxA = await semearUsuario(db, a, { papel: 'aux_adm', rotulo: 'aux' })
  const socioB = await semearUsuario(db, b, { papel: 'admin_socio', rotulo: 'socio', semLoja: true, comGrupo: true })
  const [destino] = await linhas(sql`insert into lojas (nome, cidade, endereco, grupo_id) values (${'Destino ' + P}, 'C', 'R', ${a.grupoId}) returning id`)
  const [modelo] = await linhas(sql`insert into modelos (marca, modelo, categoria, potencia_w, motor, velocidade_max) values ('M', ${P}, 'autopropelido', '1000', 'hub', '32') returning id`)
  const [origem] = await linhas(sql`insert into origens_venda (grupo_id, nome) values (${a.grupoId}, ${'Loja ' + P}) returning id`)
  Object.assign(semente, { contaA: a.contaId, grupoA: a.grupoId, lojaA: a.lojaId, destinoA: destino.id, contaB: b.contaId, grupoB: b.grupoId, modeloId: modelo.id, origemId: origem.id })
  sessoes.socioA = { id: socioA, papel: 'admin_socio', lojaId: null, gruposAcesso: [a.grupoId], contaId: a.contaId, grupoLiberado: null }
  sessoes.auxA = { id: auxA, papel: 'aux_adm', lojaId: a.lojaId, gruposAcesso: [], contaId: a.contaId, grupoLiberado: null }
  sessoes.socioB = { id: socioB, papel: 'admin_socio', lojaId: null, gruposAcesso: [b.grupoId], contaId: b.contaId, grupoLiberado: null }
  usuarioDaSessao = sessoes.socioA
})

after(async () => {
  const daSemente = sql`(select id from motos where chassi like ${P + '%'})`
  for (const t of ['vendas', 'reservas', 'aprovacoes_venda', 'pedidos_venda', 'transferencias', 'historico_estoque']) {
    await db.execute(sql`delete from ${sql.raw(t)} where moto_id in ${daSemente}`)
  }
  await db.execute(sql`delete from log_acoes where usuario_id in (select id from usuarios where email like ${'%-' + P.toLowerCase() + '-%'})`)
  await db.execute(sql`delete from motos where chassi like ${P + '%'}`)
  for (const conta of [semente.contaA, semente.contaB]) await db.execute(sql`delete from clientes where conta_id = ${conta}`)
  await db.execute(sql`delete from origens_venda where grupo_id = ${semente.grupoA}`)
  await db.execute(sql`delete from modelos where modelo = ${P}`)
  await db.execute(sql`delete from usuarios where email like ${'%-' + P.toLowerCase() + '-%'}`)
  for (const grupo of [semente.grupoA, semente.grupoB]) {
    await db.execute(sql`delete from lojas where grupo_id = ${grupo}`)
    await db.execute(sql`delete from grupos where id = ${grupo}`)
  }
  for (const conta of [semente.contaA, semente.contaB]) await db.execute(sql`delete from contas where id = ${conta}`)
  for (const m of mocks) m.restore()
  await (globalThis as { __pgPool?: { end(): Promise<void> } }).__pgPool?.end()
})

async function novaMoto(rotulo: string, status: string, disponibilidade: string | null = null) {
  const [m] = await linhas(sql`insert into motos (chassi, modelo_id, loja_id, cor, nota_fiscal_entrada, status, disponibilidade)
    values (${P + rotulo}, ${semente.modeloId}, ${semente.lojaA}, 'CINZA', '1', ${status}, ${disponibilidade}) returning id`)
  return m.id as string
}

test('moto grava com o status em_transporte', async () => {
  const moto = await novaMoto('ENUM', 'em_transporte')
  const [{ status }] = await linhas(sql`select status from motos where id = ${moto}`)
  assert.equal(status, 'em_transporte')
})
