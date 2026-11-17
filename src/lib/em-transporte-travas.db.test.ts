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

type Vendas = typeof import('@/app/(dashboard)/vendas/actions')
const vendas = () => import('@/app/(dashboard)/vendas/actions') as Promise<Vendas>

const cliente = { clienteNome: 'Cliente ' + P, clienteCpf: CPF, clienteCelular: '35999990009', clienteEmail: 'c@example.com',
  clienteCep: '', clienteLogradouro: '', clienteNumero: '', clienteComplemento: '', clienteBairro: '', clienteCidade: '', clienteEstado: '' }
const venda = (motoId: string, tipo = 'pix') => ({ motoId, ...cliente, valorTotal: '1000', pagamentos: [{ tipo, valor: 1000 }], origemId: semente.origemId })
const reserva = (motoId: string) => ({ motoId, ...cliente, valorReserva: '300', valorTotalVenda: '1000',
  pagamentos: [{ tipo: 'pix', valor: 300 }], dataPrevistaFinalizacao: '2026-11-30' })

/** O que a moto tem gravado: status, disponibilidade e quantas linhas de cada coisa a apontam. */
const estadoDa = async (motoId: string) => (await linhas(sql`select m.status, m.disponibilidade,
  (select count(*)::int from vendas v where v.moto_id = m.id) as vendas,
  (select count(*)::int from aprovacoes_venda a where a.moto_id = m.id) as aprovacoes,
  (select count(*)::int from pedidos_venda p where p.moto_id = m.id) as pedidos,
  (select count(*)::int from transferencias t where t.moto_id = m.id) as transferencias
  from motos m where m.id = ${motoId}`))[0]
const intacta = (status: string, disponibilidade: string | null) => ({ status, disponibilidade, vendas: 0, aprovacoes: 0, pedidos: 0, transferencias: 0 })

const EM_TRANSPORTE_NAO_VENDE = 'Moto ainda em transporte. Não pode ser vendida.'

test('venda direta de moto em transporte: recusa com a frase do status; nada gravado', async () => {
  usuarioDaSessao = sessoes.socioA
  const moto = await novaMoto('VEN', 'em_transporte', 'disponivel')
  assert.deepEqual(await (await vendas()).registrarVendaCompletaAction(venda(moto)), { ok: false, erro: EM_TRANSPORTE_NAO_VENDE })
  assert.deepEqual(await estadoDa(moto), intacta('em_transporte', 'disponivel'))
})

test('pedido de aprovação de moto em transporte: recusa com a frase do status; nada gravado', async () => {
  usuarioDaSessao = sessoes.socioA
  const moto = await novaMoto('APR', 'em_transporte', 'disponivel')
  assert.deepEqual(await (await vendas()).solicitarAprovacaoVendaAction(venda(moto, 'transferencia'), '', 'pagamento_sensivel'), { ok: false, erro: EM_TRANSPORTE_NAO_VENDE })
  assert.deepEqual(await estadoDa(moto), intacta('em_transporte', 'disponivel'))
})

test('pedido de venda de moto em transporte: recusa com a frase do status; nenhum pedido', async () => {
  usuarioDaSessao = sessoes.socioA
  const moto = await novaMoto('PED', 'em_transporte', 'disponivel')
  assert.deepEqual(await (await vendas()).criarPedidoVendaAction(moto), { ok: false, erro: EM_TRANSPORTE_NAO_VENDE })
  assert.deepEqual(await estadoDa(moto), intacta('em_transporte', 'disponivel'))
})

test('cancelar a reserva de moto em transporte devolve sem disponibilidade (não vai à venda)', async () => {
  usuarioDaSessao = sessoes.socioA
  const moto = await novaMoto('RES', 'em_transporte')
  const acoes = await vendas()
  assert.equal((await acoes.registrarReservaAction(reserva(moto))).ok, true)
  const [{ id }] = await linhas(sql`select id from reservas where moto_id = ${moto} and status = 'ativa'`)
  assert.equal((await acoes.cancelarReservaAction(id, 'cliente desistiu')).ok, true)
  assert.deepEqual(await estadoDa(moto), intacta('em_transporte', null))
})

const transferencias = () => import('@/app/(dashboard)/transferencias/actions')
const EM_TRANSPORTE_NAO_TRANSFERE = 'Moto ainda em transporte. Marque a chegada antes de transferir.'

test('transferir moto em transporte, como sócio ou aux_adm: recusa com a frase da chegada; nenhuma transferência', async () => {
  const moto = await novaMoto('TRF', 'em_transporte')
  const { solicitarTransferenciaAction } = await transferencias()
  for (const sessao of [sessoes.socioA, sessoes.auxA]) {
    usuarioDaSessao = sessao
    assert.deepEqual(await solicitarTransferenciaAction(moto, semente.destinoA), { ok: false, erro: EM_TRANSPORTE_NAO_TRANSFERE })
  }
  assert.deepEqual(await estadoDa(moto), intacta('em_transporte', null))
})

test('transferir moto na caixa continua valendo para o aux_adm', async () => {
  usuarioDaSessao = sessoes.auxA
  const moto = await novaMoto('TRFCX', 'caixa')
  assert.deepEqual(await (await transferencias()).solicitarTransferenciaAction(moto, semente.destinoA), { ok: true, dados: undefined })
  assert.equal((await estadoDa(moto)).transferencias, 1)
})

test('a lista de motos para transferir deixa de fora a em transporte e a vendida; o legado faturada continua', async () => {
  const motos = { em_transporte: await novaMoto('LSTET', 'em_transporte'), vendida: await novaMoto('LSTVD', 'vendida'),
    caixa: await novaMoto('LSTCX', 'caixa'), faturada: await novaMoto('LSTFT', 'faturada') }
  const { listarMotosTransferiveis } = await import('@/lib/queries/transferencias')
  const ids = new Set((await listarMotosTransferiveis([semente.lojaA])).map(m => m.id))
  assert.deepEqual(Object.entries(motos).filter(([, id]) => ids.has(id)).map(([status]) => status), ['caixa', 'faturada'])
})

test('transferir moto vendida, chamando a action direto: recusa com a frase da regra; nenhuma transferência', async () => {
  usuarioDaSessao = sessoes.socioA
  const moto = await novaMoto('TRFVD', 'vendida')
  assert.deepEqual(await (await transferencias()).solicitarTransferenciaAction(moto, semente.destinoA), { ok: false, erro: 'Moto já foi vendida' })
  assert.equal((await estadoDa(moto)).transferencias, 0)
})

const estoque = () => import('@/app/(dashboard)/estoque/[id]/actions')

test('o admin corrige Caixa → Em transporte pelo Editar moto; o histórico guarda antes, depois e quem', async () => {
  usuarioDaSessao = sessoes.socioA
  const moto = await novaMoto('EDT', 'caixa')
  await (await estoque()).editarMotoAction(moto, { status: 'em_transporte' })
  assert.equal((await estadoDa(moto)).status, 'em_transporte')
  const historico = await linhas(sql`select status_anterior, status_novo, usuario_id from historico_estoque where moto_id = ${moto}`)
  assert.deepEqual(historico, [{ status_anterior: 'caixa', status_novo: 'em_transporte', usuario_id: sessoes.socioA.id }])
})

test('aux_adm não põe moto em transporte: nem pela troca de status, nem pelo Editar moto', async () => {
  usuarioDaSessao = sessoes.auxA
  const moto = await novaMoto('AUX', 'caixa')
  const acoes = await estoque()
  await assert.rejects(acoes.alterarStatusAction(moto, 'em_transporte'), { message: 'Transição caixa → em_transporte não permitida' })
  await assert.rejects(acoes.editarMotoAction(moto, { status: 'em_transporte' }), { message: 'Sem permissão para editar moto' })
  assert.deepEqual(await estadoDa(moto), intacta('caixa', null))
})

test('status fora da lista, forjado: Editar moto e troca de status recusam; a moto não muda', async () => {
  usuarioDaSessao = sessoes.socioA
  const moto = await novaMoto('XYZ', 'em_transporte')
  const acoes = await estoque()
  await assert.rejects(acoes.editarMotoAction(moto, { status: 'xyz' }), { message: 'Status inválido' })
  await assert.rejects(acoes.alterarStatusAction(moto, 'xyz'), { message: 'Status inválido' })
  assert.deepEqual(await estadoDa(moto), intacta('em_transporte', null))
})

test('Conta B não vende, não transfere nem edita moto em transporte da Conta A: a mesma frase do id inexistente', async () => {
  usuarioDaSessao = sessoes.socioB
  const moto = await novaMoto('CTB', 'em_transporte', 'disponivel')
  const inexistente = '00000000-0000-4000-8000-000000000009'
  const { registrarVendaCompletaAction } = await vendas()
  const { solicitarTransferenciaAction } = await transferencias()
  const { editarMotoAction } = await estoque()
  for (const id of [moto, inexistente]) {
    assert.deepEqual(await registrarVendaCompletaAction(venda(id)), { ok: false, erro: 'Moto não encontrada' })
    assert.deepEqual(await solicitarTransferenciaAction(id, semente.destinoA), { ok: false, erro: 'Moto não encontrada' })
    await assert.rejects(editarMotoAction(id, { status: 'caixa' }), { message: 'Moto não encontrada' })
  }
  assert.deepEqual(await estadoDa(moto), intacta('em_transporte', 'disponivel'))
})
