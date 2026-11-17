// Teste de banco: Postgres descartável. Conferência do preço mínimo no servidor com cartão (#50):
// a taxa da maquininha é % do bruto, então 10.900 em 12x a 9% deixa 9.919 para a loja. Chama as
// Server Actions direto, com o papel real. Cada Conta usa a própria taxa: a Conta B tem 12x a 0%.
// Fronteira de fora mockada: sessão, next/cache, Kommo e WhatsApp.
import { after, before, mock, test } from 'node:test'
import assert from 'node:assert/strict'
import { sql } from 'drizzle-orm'
import { semearContaBase, semearUsuario, type Base } from '@/test/semear-conta'

const url = process.env.TEST_DATABASE_URL
if (!url) throw new Error('TEST_DATABASE_URL não definida — este teste só roda num Postgres descartável')
if (!['localhost', '127.0.0.1'].includes(new URL(url).hostname)) {
  throw new Error('TEST_DATABASE_URL precisa ser loopback (Postgres descartável)')
}
process.env.DATABASE_URL = url

const P = 'TXC50'
const CPF = '52998224725'
let usuarioDaSessao: Record<string, unknown> = {}

type Db = typeof import('@/lib/db')
let db: Db['db']
let execRows: Db['execRows']
const mocks = [
  mock.module('@/lib/auth', { namedExports: { getUsuarioLogado: async () => usuarioDaSessao } }),
  mock.module('next/cache', { namedExports: { revalidatePath: () => {} } }),
  mock.module('@/lib/kommo', { namedExports: { virarLeadKommo: async () => ({ resultado: 'sem_lead' }) } }),
  mock.module('@/lib/whatsapp/venda', { namedExports: { notificarVendaWhatsapp: async () => ({ resultado: 'desligado' }) } }),
]

type Vendas = typeof import('@/app/(dashboard)/vendas/actions')
let acoes: Pick<Vendas, 'registrarVendaCompletaAction' | 'solicitarAprovacaoVendaAction'>

type Conta = { base: Base; vendedorId: string; socioId: string; origemId: string }
let modeloId = ''
const contas: Record<'A' | 'B', Conta> = {} as Record<'A' | 'B', Conta>

async function semearConta(nome: 'A' | 'B', cnpj: string, taxa12x: number): Promise<Conta> {
  const base = await semearContaBase(db, { prefixo: P, nome, cnpj })
  const vendedorId = await semearUsuario(db, base, { papel: 'vendedor', comGrupo: true })
  const socioId = await semearUsuario(db, base, { papel: 'admin_socio', rotulo: 'socio', semLoja: true, comGrupo: true })
  const [origem] = await execRows(sql`insert into origens_venda (grupo_id, nome) values (${base.grupoId}, ${'Loja ' + P}) returning id`)
  await db.execute(sql`insert into precificacao (grupo_id, nome, valor_minimo) values (${base.grupoId}, ${P}, '10000.00')`)
  await db.execute(sql`insert into configuracao_taxas (grupo_id, taxas_cartao) values (${base.grupoId}, ${JSON.stringify({ '12': taxa12x })}::jsonb)`)
  return { base, vendedorId, socioId, origemId: origem.id }
}

before(async () => {
  ;({ db, execRows } = await import('@/lib/db'))
  acoes = await import('@/app/(dashboard)/vendas/actions')
  const [modelo] = await execRows(sql`insert into modelos (marca, modelo, categoria, potencia_w, motor, velocidade_max) values ('M', ${P}, 'autopropelido', '1000', 'hub', '32') returning id`)
  modeloId = modelo.id
  contas.A = await semearConta('A', '00000000005001', 0.09)
  contas.B = await semearConta('B', '00000000005002', 0)
})

after(async () => {
  const daSemente = sql`(select id from motos where chassi like ${P + '%'})`
  for (const t of ['vendas', 'pedidos_venda', 'reservas', 'aprovacoes_venda', 'historico_estoque']) {
    await db.execute(sql`delete from ${sql.raw(t)} where moto_id in ${daSemente}`)
  }
  for (const c of Object.values(contas)) {
    await db.execute(sql`delete from log_acoes where usuario_id in (${c.vendedorId}, ${c.socioId})`)
  }
  await db.execute(sql`delete from motos where chassi like ${P + '%'}`)
  for (const c of Object.values(contas)) {
    const { contaId, grupoId } = c.base
    await db.execute(sql`delete from clientes where conta_id = ${contaId}`)
    await db.execute(sql`delete from origens_venda where grupo_id = ${grupoId}`)
    await db.execute(sql`delete from precificacao where grupo_id = ${grupoId}`)
    await db.execute(sql`delete from configuracao_taxas where grupo_id = ${grupoId}`)
  }
  await db.execute(sql`delete from modelos where modelo = ${P}`)
  await db.execute(sql`delete from usuarios where email like ${'%-' + P.toLowerCase() + '-%'}`)
  for (const c of Object.values(contas)) {
    await db.execute(sql`delete from lojas where grupo_id = ${c.base.grupoId}`)
    await db.execute(sql`delete from grupos where id = ${c.base.grupoId}`)
    await db.execute(sql`delete from contas where id = ${c.base.contaId}`)
  }
  for (const m of mocks) m.restore()
  await (globalThis as { __pgPool?: { end(): Promise<void> } }).__pgPool?.end()
})

async function novaMoto(conta: Conta, rotulo: string) {
  const [m] = await execRows(sql`insert into motos (chassi, modelo_id, loja_id, cor, nota_fiscal_entrada, status, disponibilidade)
    values (${P + rotulo}, ${modeloId}, ${conta.base.lojaId}, 'CINZA', '1', 'montada', 'disponivel') returning id`)
  return m.id as string
}

const sessaoDe = (conta: Conta, papel: 'vendedor' | 'admin_socio') => ({
  id: papel === 'vendedor' ? conta.vendedorId : conta.socioId,
  papel,
  lojaId: papel === 'vendedor' ? conta.base.lojaId : null,
  gruposAcesso: [conta.base.grupoId],
  contaId: conta.base.contaId,
  grupoLiberado: null,
})

const cliente = { clienteNome: 'Cliente ' + P, clienteCpf: CPF, clienteCelular: '35999990950', clienteEmail: 'c@example.com',
  clienteCep: '', clienteLogradouro: '', clienteNumero: '', clienteComplemento: '', clienteBairro: '', clienteCidade: '', clienteEstado: '' }
const vendaNoCartao12x = (conta: Conta, motoId: string, valor: number) => ({
  motoId, ...cliente, valorTotal: valor.toFixed(2), origemId: conta.origemId,
  pagamentos: [{ tipo: 'cartao_credito', valor, parcelas: 12 }],
})
const estadoDa = async (motoId: string) => (await execRows(sql`select m.disponibilidade,
  (select count(*)::int from vendas v where v.moto_id = m.id) as vendas
  from motos m where m.id = ${motoId}`))[0]

test('vendedor: 10.900 em 12x a 9% deixa 9.919, abaixo do mínimo de 10.000; recusa e não grava nada', async () => {
  const moto = await novaMoto(contas.A, 'ABAIXO')
  usuarioDaSessao = sessaoDe(contas.A, 'vendedor')
  const r = await acoes.registrarVendaCompletaAction(vendaNoCartao12x(contas.A, moto, 10900))
  assert.equal(r.ok, false)
  assert.match(!r.ok ? r.erro : '', /^Valor abaixo do mínimo: líquido estimado R\$\s9\.919,00, mínimo PIX R\$\s10\.000,00\./)
  assert.deepEqual(await estadoDa(moto), { disponibilidade: 'disponivel', vendas: 0 })
})

test('vendedor: cobrar o bruto que embute a taxa (10.989,01) passa no mínimo e grava a venda', async () => {
  const moto = await novaMoto(contas.A, 'NOMINIMO')
  usuarioDaSessao = sessaoDe(contas.A, 'vendedor')
  const r = await acoes.registrarVendaCompletaAction(vendaNoCartao12x(contas.A, moto, 10989.01))
  assert.equal(r.ok, true)
  assert.equal((await estadoDa(moto)).vendas, 1)
})

test('vendedor: pedido de aprovação de 10.900 em 12x grava o líquido 9.919 e o mínimo 10.000', async () => {
  const moto = await novaMoto(contas.A, 'APROVACAO')
  usuarioDaSessao = sessaoDe(contas.A, 'vendedor')
  const r = await acoes.solicitarAprovacaoVendaAction(vendaNoCartao12x(contas.A, moto, 10900), 'Cliente pediu 12x')
  assert.equal(r.ok, true)
  const [aprovacao] = await execRows(sql`select status, liquido_snapshot, valor_minimo_snapshot from aprovacoes_venda where moto_id = ${moto}`)
  assert.deepEqual(aprovacao, { status: 'pendente', liquido_snapshot: '9919.00', valor_minimo_snapshot: '10000.00' })
})

test('sócio vende abaixo do mínimo direto, como antes', async () => {
  const moto = await novaMoto(contas.A, 'SOCIO')
  usuarioDaSessao = sessaoDe(contas.A, 'admin_socio')
  const r = await acoes.registrarVendaCompletaAction(vendaNoCartao12x(contas.A, moto, 10900))
  assert.equal(r.ok, true)
  assert.equal((await estadoDa(moto)).vendas, 1)
})

test('cada Conta usa a própria taxa: na Conta B, com 12x a 0%, os mesmos 10.900 passam', async () => {
  const moto = await novaMoto(contas.B, 'CONTAB')
  usuarioDaSessao = sessaoDe(contas.B, 'vendedor')
  const r = await acoes.registrarVendaCompletaAction(vendaNoCartao12x(contas.B, moto, 10900))
  assert.equal(r.ok, true)
  assert.equal((await estadoDa(moto)).vendas, 1)
})
