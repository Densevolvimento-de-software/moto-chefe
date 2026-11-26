// Teste de banco (#283): a entrada mínima da reserva é a porcentagem da LOJA da moto, aplicada ao
// preço mínimo PIX do modelo, pela Server Action de verdade contra o Postgres descartável. Só a
// fronteira de fora é simulada: sessão, cookie do grupo ativo, revalidatePath, Kommo e WhatsApp.
import { after, before, mock, test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { semearContaBase, semearLoja, semearModelo, semearUsuario, type Base } from '@/test/semear-conta'

const url = process.env.TEST_DATABASE_URL
if (!url || !['localhost', '127.0.0.1'].includes(new URL(url).hostname)) throw new Error('Use somente Postgres descartável local')
process.env.DATABASE_URL = url

type Db = typeof import('@/lib/db')
let db: Db['db']
let execRows: Db['execRows']
let vendas: typeof import('@/app/(dashboard)/vendas/actions')
let usuario: Record<string, unknown> = {}
let grupoAtivoNoCookie: string | null = null

const mocks = [
  mock.module('@/lib/auth', { namedExports: { getUsuarioLogado: async () => usuario } }),
  mock.module('next/cache', { namedExports: { revalidatePath: () => {} } }),
  mock.module('next/headers', {
    namedExports: { cookies: async () => ({ get: (n: string) => (n === 'grupoAtivo' && grupoAtivoNoCookie ? { value: grupoAtivoNoCookie } : undefined) }) },
  }),
  mock.module('@/lib/kommo', { namedExports: { virarLeadKommo: async () => ({ resultado: 'sem_lead' }) } }),
  mock.module('@/lib/whatsapp/venda', { namedExports: { notificarVendaWhatsapp: async () => ({ resultado: 'desligado' }) } }),
]

before(async () => {
  ;({ db, execRows } = await import('@/lib/db'))
  vendas = await import('@/app/(dashboard)/vendas/actions')
})
after(async () => {
  for (const m of mocks) m.restore()
  await (globalThis as { __pgPool?: { end(): Promise<void> } }).__pgPool?.end()
})

const PIX = 15000
const CPF = '52998224725'
const cliente = { clienteNome: 'Cliente sintético', clienteCpf: CPF, clienteCelular: '35999990283', clienteEmail: 'c@teste.invalid',
  clienteCep: '', clienteLogradouro: '', clienteNumero: '', clienteComplemento: '', clienteBairro: '', clienteCidade: '', clienteEstado: '' }

type Cenario = { base: Base; socioId: string; vendedorId: string; modeloId: string; modeloSemPrecoId: string; lojas: Record<number, string> }

/** Conta nova com uma loja para cada porcentagem pedida (a do padrão é a loja da base, que não é tocada). */
async function novaConta(porcentagens: number[]): Promise<Cenario> {
  const suf = randomUUID()
  const base = await semearContaBase(db, { prefixo: 'EM283', nome: suf, cnpj: suf })
  const socioId = await semearUsuario(db, base, { papel: 'admin_socio', rotulo: 'socio', comGrupo: true })
  const vendedorId = await semearUsuario(db, base, { papel: 'vendedor', comGrupo: true })
  const modelo = 'EM283 ' + suf
  const modeloId = await semearModelo(db, modelo)
  const modeloSemPrecoId = await semearModelo(db, 'EM283 sem preço ' + suf)
  await db.execute(sql`insert into configuracao_taxas (grupo_id) values (${base.grupoId})`)
  await db.execute(sql`insert into precificacao (nome, valor_minimo, grupo_id) values (${modelo}, ${PIX}, ${base.grupoId})`)
  const lojas: Record<number, string> = {}
  for (const pct of porcentagens) {
    const lojaId = await semearLoja(db, base.grupoId, `EM283 ${pct}% ${suf}`)
    await db.execute(sql`update lojas set entrada_minima_reserva_pct = ${pct} where id = ${lojaId}`)
    lojas[pct] = lojaId
  }
  return { base, socioId, vendedorId, modeloId, modeloSemPrecoId, lojas }
}

const entrarComoSocio = (c: Cenario) => {
  usuario = { id: c.socioId, nome: 'sócio de teste', email: 'socio@teste.invalid', papel: 'admin_socio', lojaId: c.base.lojaId,
    contaId: c.base.contaId, gruposAcesso: [c.base.grupoId], gruposAprovacao: [], grupoLiberado: null, aprovaPagamentoSensivel: true }
  grupoAtivoNoCookie = c.base.grupoId
}

async function novaMoto(c: Cenario, lojaId: string, modeloId = c.modeloId) {
  const [m] = await execRows(sql`insert into motos (chassi, modelo_id, loja_id, cor, nota_fiscal_entrada, status, disponibilidade)
    values (${'EM283' + randomUUID()}, ${modeloId}, ${lojaId}, 'CINZA', '1', 'montada', 'disponivel') returning id`)
  return m.id as string
}

const reservar = (motoId: string, entrada: number) => vendas.registrarReservaAction({
  motoId, ...cliente, valorReserva: entrada.toFixed(2), valorTotalVenda: '20000.00',
  pagamentos: [{ tipo: 'pix', valor: entrada }], dataPrevistaFinalizacao: '2026-12-01',
} as never)

const reservasDaMoto = async (motoId: string) => (await execRows(sql`select valor_reserva::float8 as valor, status from reservas where moto_id = ${motoId}`))
const espacoComum = (t: string) => t.replace(/ /g, ' ')

test('loja com 20%: aceita R$ 3.000,00 e recusa R$ 2.999,00, e a recusa não grava nada', async () => {
  const c = await novaConta([20])
  entrarComoSocio(c)
  const recusada = await novaMoto(c, c.lojas[20])
  const r = await reservar(recusada, 2999)
  assert.deepEqual(r.ok ? r : { ok: false, erro: espacoComum(r.erro) }, { ok: false, erro: 'Entrada mínima de R$ 3.000,00 (20% do preço PIX R$ 15.000,00)' })
  assert.deepEqual(await reservasDaMoto(recusada), [])
  const aceita = await novaMoto(c, c.lojas[20])
  assert.equal((await reservar(aceita, 3000)).ok, true)
  assert.deepEqual(await reservasDaMoto(aceita), [{ valor: 3000, status: 'ativa' }])
})

test('loja sem ajuste segue em 30%: recusa R$ 4.499,00 com a frase dos 30% e aceita R$ 4.500,00', async () => {
  const c = await novaConta([])
  entrarComoSocio(c)
  const moto = await novaMoto(c, c.base.lojaId)
  const r = await reservar(moto, 4499)
  assert.deepEqual(r.ok ? r : { ok: false, erro: espacoComum(r.erro) }, { ok: false, erro: 'Entrada mínima de R$ 4.500,00 (30% do preço PIX R$ 15.000,00)' })
  assert.equal((await reservar(await novaMoto(c, c.base.lojaId), 4500)).ok, true)
})

test('0% aceita qualquer entrada; 100% exige o preço PIX inteiro', async () => {
  const c = await novaConta([0, 100])
  entrarComoSocio(c)
  assert.equal((await reservar(await novaMoto(c, c.lojas[0]), 1)).ok, true)
  assert.equal((await reservar(await novaMoto(c, c.lojas[100]), 14999)).ok, false)
  assert.equal((await reservar(await novaMoto(c, c.lojas[100]), 15000)).ok, true)
})

test('vale a porcentagem da loja da MOTO, não a da loja de quem reserva', async () => {
  const c = await novaConta([20])
  entrarComoSocio(c) // o sócio trabalha na loja da base (30%); a moto está na loja de 20%
  const moto = await novaMoto(c, c.lojas[20])
  assert.equal((await reservar(moto, 3000)).ok, true)
})

test('modelo sem precificação continua sem conferência da entrada', async () => {
  const c = await novaConta([])
  entrarComoSocio(c)
  assert.equal((await reservar(await novaMoto(c, c.base.lojaId, c.modeloSemPrecoId), 1)).ok, true)
})

test('mudar a porcentagem depois não mexe na reserva já registrada', async () => {
  const c = await novaConta([20])
  entrarComoSocio(c)
  const moto = await novaMoto(c, c.lojas[20])
  assert.equal((await reservar(moto, 3000)).ok, true)
  await db.execute(sql`update lojas set entrada_minima_reserva_pct = 100 where id = ${c.lojas[20]}`)
  assert.deepEqual(await reservasDaMoto(moto), [{ valor: 3000, status: 'ativa' }])
})
