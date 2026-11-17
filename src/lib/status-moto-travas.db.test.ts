// Teste de banco: Postgres descartável. Travas de venda e de reserva pelo status da moto (#941),
// chamando as Server Actions direto: moto na caixa não vende nem pede aprovação, com a frase de
// sempre; cancelar a reserva devolve a moto na caixa sem disponibilidade e a montada a "disponivel".
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

const P = 'STM941'
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

type Vendas = typeof import('@/app/(dashboard)/vendas/actions')
let acoes: Pick<Vendas, 'registrarVendaCompletaAction' | 'solicitarAprovacaoVendaAction' | 'registrarReservaAction' | 'cancelarReservaAction'>
const semente = { contaId: '', grupoId: '', lojaId: '', modeloId: '', origemId: '', socioId: '' }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const linhas = async (q: ReturnType<typeof sql>) => ((await db.execute(q)) as unknown as { rows: any[] }).rows

before(async () => {
  ;({ db } = await import('@/lib/db'))
  acoes = await import('@/app/(dashboard)/vendas/actions')
  const base = await semearContaBase(db, { prefixo: P, nome: 'A', cnpj: '00000000094160' })
  const socioId = await semearUsuario(db, base, { papel: 'admin_socio', rotulo: 'socio', semLoja: true, comGrupo: true })
  const [modelo] = await linhas(sql`insert into modelos (marca, modelo, categoria, potencia_w, motor, velocidade_max) values ('M', ${P}, 'autopropelido', '1000', 'hub', '32') returning id`)
  const [origem] = await linhas(sql`insert into origens_venda (grupo_id, nome) values (${base.grupoId}, ${'Loja ' + P}) returning id`)
  Object.assign(semente, { contaId: base.contaId, grupoId: base.grupoId, lojaId: base.lojaId, modeloId: modelo.id, origemId: origem.id, socioId })
  usuarioDaSessao = { id: socioId, papel: 'admin_socio', lojaId: null, gruposAcesso: [base.grupoId], contaId: base.contaId, grupoLiberado: null }
})

after(async () => {
  const daSemente = sql`(select id from motos where chassi like ${P + '%'})`
  for (const t of ['vendas', 'reservas', 'aprovacoes_venda', 'historico_estoque']) {
    await db.execute(sql`delete from ${sql.raw(t)} where moto_id in ${daSemente}`)
  }
  await db.execute(sql`delete from log_acoes where usuario_id = ${semente.socioId}`)
  await db.execute(sql`delete from motos where chassi like ${P + '%'}`)
  await db.execute(sql`delete from clientes where conta_id = ${semente.contaId}`)
  await db.execute(sql`delete from origens_venda where grupo_id = ${semente.grupoId}`)
  await db.execute(sql`delete from modelos where modelo = ${P}`)
  await db.execute(sql`delete from usuarios where email like ${'%-' + P.toLowerCase() + '-%'}`)
  await db.execute(sql`delete from lojas where grupo_id = ${semente.grupoId}`)
  await db.execute(sql`delete from grupos where id = ${semente.grupoId}`)
  await db.execute(sql`delete from contas where id = ${semente.contaId}`)
  for (const m of mocks) m.restore()
  await (globalThis as { __pgPool?: { end(): Promise<void> } }).__pgPool?.end()
})

async function novaMoto(rotulo: string, status: string, disponibilidade: string | null) {
  const [m] = await linhas(sql`insert into motos (chassi, modelo_id, loja_id, cor, nota_fiscal_entrada, status, disponibilidade)
    values (${P + rotulo}, ${semente.modeloId}, ${semente.lojaId}, 'CINZA', '1', ${status}, ${disponibilidade}) returning id`)
  return m.id as string
}

const cliente = { clienteNome: 'Cliente ' + P, clienteCpf: CPF, clienteCelular: '35999990941', clienteEmail: 'c@example.com',
  clienteCep: '', clienteLogradouro: '', clienteNumero: '', clienteComplemento: '', clienteBairro: '', clienteCidade: '', clienteEstado: '' }
const venda = (motoId: string, tipo = 'pix') => ({ motoId, ...cliente, valorTotal: '1000', pagamentos: [{ tipo, valor: 1000 }], origemId: semente.origemId })
const reserva = (motoId: string) => ({ motoId, ...cliente, valorReserva: '300', valorTotalVenda: '1000',
  pagamentos: [{ tipo: 'pix', valor: 300 }], dataPrevistaFinalizacao: '2026-11-30' })
const estadoDa = async (motoId: string) => (await linhas(sql`select m.status, m.disponibilidade,
  (select count(*)::int from vendas v where v.moto_id = m.id) as vendas,
  (select count(*)::int from aprovacoes_venda a where a.moto_id = m.id) as aprovacoes
  from motos m where m.id = ${motoId}`))[0]

const NAO_MONTADA = 'Moto ainda não foi montada. Não pode ser vendida.'

test('venda direta de moto na caixa: recusa com a frase de sempre; nada gravado', async () => {
  const moto = await novaMoto('VEN', 'caixa', 'disponivel')
  assert.deepEqual(await acoes.registrarVendaCompletaAction(venda(moto)), { ok: false, erro: NAO_MONTADA })
  assert.deepEqual(await estadoDa(moto), { status: 'caixa', disponibilidade: 'disponivel', vendas: 0, aprovacoes: 0 })
})

test('pedido de aprovação de moto na caixa: recusa com a frase de sempre; nada gravado', async () => {
  const moto = await novaMoto('APR', 'caixa', 'disponivel')
  assert.deepEqual(await acoes.solicitarAprovacaoVendaAction(venda(moto, 'transferencia'), '', 'pagamento_sensivel'), { ok: false, erro: NAO_MONTADA })
  assert.deepEqual(await estadoDa(moto), { status: 'caixa', disponibilidade: 'disponivel', vendas: 0, aprovacoes: 0 })
})

async function reservarECancelar(motoId: string) {
  assert.equal((await acoes.registrarReservaAction(reserva(motoId))).ok, true)
  const [{ id }] = await linhas(sql`select id from reservas where moto_id = ${motoId} and status = 'ativa'`)
  assert.equal((await acoes.cancelarReservaAction(id, 'cliente desistiu')).ok, true)
  return (await estadoDa(motoId)).disponibilidade
}

test('cancelar a reserva de moto na caixa devolve sem disponibilidade', async () => {
  assert.equal(await reservarECancelar(await novaMoto('RCX', 'caixa', null)), null)
})

test('cancelar a reserva de moto montada devolve "disponivel"', async () => {
  assert.equal(await reservarECancelar(await novaMoto('RMT', 'montada', 'disponivel')), 'disponivel')
})
