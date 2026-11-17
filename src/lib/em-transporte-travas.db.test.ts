// Teste de banco: Postgres descartável. Status "Em transporte" (#9): as Server Actions chamadas direto,
// como faria quem abre o DevTools. Moto em transporte não vende, não pede aprovação, não vira pedido
// nem transferência; só o admin a põe nesse status, pelo Editar moto; status fora da lista é recusado;
// a Conta B recebe "Moto não encontrada", igual a um id inexistente, e nada grava na Conta A.
// Botão Chegou (#11): a chegada leva só para Caixa, guarda quem marcou e mantém a reserva.
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
const sessoes = { socioA: {} as Sessao, auxA: {} as Sessao, socioB: {} as Sessao, vendedorA: {} as Sessao, auxOutraLojaA: {} as Sessao, redeA: {} as Sessao }
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
  const vendedorA = await semearUsuario(db, a, { papel: 'vendedor', rotulo: 'vendedor' })
  const auxOutraLojaA = await semearUsuario(db, { ...a, lojaId: destino.id }, { papel: 'aux_adm', rotulo: 'auxdestino' })
  sessoes.vendedorA = { id: vendedorA, papel: 'vendedor', lojaId: a.lojaId, gruposAcesso: [], contaId: a.contaId, grupoLiberado: null }
  sessoes.auxOutraLojaA = { id: auxOutraLojaA, papel: 'aux_adm', lojaId: destino.id, gruposAcesso: [], contaId: a.contaId, grupoLiberado: null }
  // A sessão do admin_rede sai da mesma função que o getUsuarioLogado usa: ele chega como admin_socio.
  const redeA = await semearUsuario(db, a, { papel: 'admin_rede', rotulo: 'rede', semLoja: true, comGrupo: true })
  const { usuarioDaRede } = await import('@/lib/grupos-liberados')
  sessoes.redeA = { id: redeA, ...usuarioDaRede({ papel: 'admin_rede', lojaId: null, gruposAcesso: [a.grupoId], gruposAprovacao: [], contaId: a.contaId }, [], null) }
  usuarioDaSessao = sessoes.socioA
})

after(async () => {
  const daSemente = sql`(select id from motos where chassi like ${P + '%'})`
  for (const t of ['vendas', 'reservas', 'aprovacoes_venda', 'pedidos_venda', 'transferencias', 'garantias', 'historico_estoque']) {
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

// P5 (#12): reservar moto em transporte, igual caixa. O pedido vem forjado com campos a mais (DevTools).
test('aux_adm reserva moto em transporte pela action: reserva na loja da moto; a moto segue em transporte; campos a mais não mudam nada', async () => {
  usuarioDaSessao = sessoes.auxA
  const moto = await novaMoto('RSV', 'em_transporte')
  const forjada = { ...reserva(moto), status: 'montada', disponibilidade: 'disponivel', lojaId: semente.destinoA }
  assert.equal((await (await vendas()).registrarReservaAction(forjada)).ok, true)
  assert.deepEqual(await linhas(sql`select loja_id, status from reservas where moto_id = ${moto}`), [{ loja_id: semente.lojaA, status: 'ativa' }])
  assert.deepEqual(await estadoDa(moto), intacta('em_transporte', 'reservada'))
})

test('Conta B não reserva moto em transporte da Conta A: a mesma frase do id inexistente; nenhuma reserva', async () => {
  usuarioDaSessao = sessoes.socioB
  const moto = await novaMoto('RSB', 'em_transporte')
  for (const id of [moto, '00000000-0000-4000-8000-000000000012']) {
    assert.deepEqual(await (await vendas()).registrarReservaAction(reserva(id)), { ok: false, erro: 'Moto não encontrada' })
  }
  assert.deepEqual(await linhas(sql`select id from reservas where moto_id = ${moto}`), [])
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

// A moto pode mudar de status entre o pedido (ou a aprovação) e a venda: o admin a corrige pelo Editar moto.
const porNoTransporte = (motoId: string) => db.execute(sql`update motos set status = 'em_transporte' where id = ${motoId}`)

test('pedido de venda feito com a moto montada, que depois foi posta em transporte: efetivar recusa; nada vendido', async () => {
  usuarioDaSessao = sessoes.socioA
  const moto = await novaMoto('EFT', 'montada', 'disponivel')
  const acoes = await vendas()
  assert.equal((await acoes.criarPedidoVendaAction(moto)).ok, true)
  const [{ id: pedidoId }] = await linhas(sql`select id from pedidos_venda where moto_id = ${moto} and status = 'pendente'`)
  await porNoTransporte(moto)
  assert.deepEqual(await acoes.efetivarVendaAction(pedidoId, 'Cliente ' + P, CPF, '1000', 'pix', undefined, semente.origemId),
    { ok: false, erro: EM_TRANSPORTE_NAO_VENDE })
  const [{ status }] = await linhas(sql`select status from pedidos_venda where id = ${pedidoId}`)
  assert.equal(status, 'pendente')
  assert.equal((await estadoDa(moto)).vendas, 0)
})

test('aprovação pedida com a moto montada, que depois foi posta em transporte: aprovar recusa; nada vendido', async () => {
  usuarioDaSessao = sessoes.socioA
  const moto = await novaMoto('APV', 'montada', 'disponivel')
  const acoes = await vendas()
  assert.equal((await acoes.solicitarAprovacaoVendaAction(venda(moto, 'transferencia'), '', 'pagamento_sensivel')).ok, true)
  const [{ id: aprovacaoId }] = await linhas(sql`select id from aprovacoes_venda where moto_id = ${moto} and status = 'pendente'`)
  await porNoTransporte(moto)
  // Quem aprova transferência bancária tem a permissão ligada no cadastro, para o grupo da loja.
  usuarioDaSessao = { ...sessoes.socioA, aprovaPagamentoSensivel: true, gruposAprovacao: [semente.grupoA] }
  assert.deepEqual(await acoes.aprovarVendaAction(aprovacaoId), { ok: false, erro: EM_TRANSPORTE_NAO_VENDE })
  const [{ status }] = await linhas(sql`select status from aprovacoes_venda where id = ${aprovacaoId}`)
  assert.equal(status, 'pendente')
  assert.equal((await estadoDa(moto)).vendas, 0)
})

// D4 (#9): a tela não oferece o Vender de finalizar a reserva dessas motos; chamando a action direto, o servidor recusa.
test('finalizar a reserva de moto em transporte ou na caixa, pela action: recusa com a frase do status; a reserva continua', async () => {
  usuarioDaSessao = sessoes.socioA
  const acoes = await vendas()
  for (const [status, frase] of [['em_transporte', EM_TRANSPORTE_NAO_VENDE], ['caixa', 'Moto ainda não foi montada. Não pode ser vendida.']]) {
    const moto = await novaMoto('FIN' + status.toUpperCase(), status)
    assert.equal((await acoes.registrarReservaAction(reserva(moto))).ok, true, status)
    assert.deepEqual(await acoes.registrarVendaCompletaAction(venda(moto)), { ok: false, erro: frase }, status)
    const [{ ativas }] = await linhas(sql`select count(*)::int as ativas from reservas where moto_id = ${moto} and status = 'ativa'`)
    assert.deepEqual({ ativas, ...(await estadoDa(moto)) }, { ativas: 1, ...intacta(status, 'reservada') }, status)
  }
})

test('moto em transporte não vai direto para montada, nem pelo admin: a chegada vem antes', async () => {
  usuarioDaSessao = sessoes.socioA
  const moto = await novaMoto('MNT', 'em_transporte')
  await assert.rejects((await estoque()).alterarStatusAction(moto, 'montada', undefined, sessoes.socioA.id as string),
    { message: 'Transição em_transporte → montada não permitida' })
  assert.deepEqual(await estadoDa(moto), intacta('em_transporte', null))
})

// Decisão do Luis (#9): moto em transporte (e na caixa) não vai para garantia; a action recusa com a frase do status.
test('abrir garantia de moto em transporte ou na caixa, pela action: recusa com a frase do status; nenhuma garantia', async () => {
  usuarioDaSessao = sessoes.auxA
  const { abrirGarantiaAction } = await import('@/app/(dashboard)/garantias/actions')
  for (const [status, frase] of [
    ['em_transporte', 'Moto ainda em transporte. Garantia só depois da chegada.'],
    ['caixa', 'Moto ainda não foi montada. Garantia só depois da montagem.'],
  ]) {
    const moto = await novaMoto('GAR' + status.toUpperCase(), status)
    assert.deepEqual(await abrirGarantiaAction({ motoId: moto, descricao: 'bateria', dataInicio: '2026-11-17' }), { ok: false, erro: frase }, status)
    const [{ garantias }] = await linhas(sql`select count(*)::int as garantias from garantias where moto_id = ${moto}`)
    assert.deepEqual({ garantias, status: (await estadoDa(moto)).status }, { garantias: 0, status }, status)
  }
})

// Botão Chegou (#11, P3/P5): a chegada é Em transporte → Caixa, por aux_adm da loja da moto e pelos admins.
const JA_CHEGOU = 'Esta moto não está mais em transporte.'
const SEM_PERMISSAO_CHEGADA = 'Sem permissão para marcar a chegada desta moto.'
const historicoDa = (motoId: string) =>
  linhas(sql`select status_anterior, status_novo, usuario_id, observacao from historico_estoque where moto_id = ${motoId}`)
const chegada = (quem: Sessao) =>
  [{ status_anterior: 'em_transporte', status_novo: 'caixa', usuario_id: quem.id, observacao: 'Chegada marcada' }]

test('aux_adm da loja e sócio marcam a chegada: a moto vai para Caixa e o histórico guarda quem marcou', async () => {
  const { marcarChegadaAction } = await estoque()
  for (const [rotulo, sessao] of [['CHGAUX', sessoes.auxA], ['CHGSOC', sessoes.socioA]] as const) {
    usuarioDaSessao = sessao
    const moto = await novaMoto(rotulo, 'em_transporte')
    assert.deepEqual(await marcarChegadaAction(moto), { ok: true, dados: undefined }, rotulo)
    assert.deepEqual(await estadoDa(moto), intacta('caixa', null), rotulo)
    assert.deepEqual(await historicoDa(moto), chegada(sessao), rotulo)
  }
})

test('a troca de status genérica não marca a chegada: Em transporte → Caixa só pelo botão Chegou', async () => {
  const { alterarStatusAction } = await estoque()
  for (const [rotulo, sessao] of [['CHGALTAUX', sessoes.auxA], ['CHGALTSOC', sessoes.socioA]] as const) {
    usuarioDaSessao = sessao
    const moto = await novaMoto(rotulo, 'em_transporte')
    await assert.rejects(alterarStatusAction(moto, 'caixa'), { message: 'Transição em_transporte → caixa não permitida' }, rotulo)
    assert.deepEqual(await estadoDa(moto), intacta('em_transporte', null), rotulo)
    assert.deepEqual(await historicoDa(moto), [], rotulo)
  }
})

test('marcar a chegada de moto reservada: vai para Caixa e a reserva continua', async () => {
  usuarioDaSessao = sessoes.auxA
  const moto = await novaMoto('CHGRES', 'em_transporte')
  assert.equal((await (await vendas()).registrarReservaAction(reserva(moto))).ok, true)
  assert.deepEqual(await (await estoque()).marcarChegadaAction(moto), { ok: true, dados: undefined })
  const [{ ativas }] = await linhas(sql`select count(*)::int as ativas from reservas where moto_id = ${moto} and status = 'ativa'`)
  assert.deepEqual({ ativas, ...(await estadoDa(moto)) }, { ativas: 1, ...intacta('caixa', 'reservada') })
})

test('marcar de novo a chegada (clique duplo, ou outra pessoa já marcou): recusa; nada muda', async () => {
  usuarioDaSessao = sessoes.auxA
  const moto = await novaMoto('CHGDUP', 'em_transporte')
  const { marcarChegadaAction } = await estoque()
  assert.equal((await marcarChegadaAction(moto)).ok, true)
  assert.deepEqual(await marcarChegadaAction(moto), { ok: false, erro: JA_CHEGOU })
  assert.deepEqual(await historicoDa(moto), chegada(sessoes.auxA))
})

test('vendedor da loja não marca a chegada: recusa sem permissão; nada muda', async () => {
  usuarioDaSessao = sessoes.vendedorA
  const moto = await novaMoto('CHGVEN', 'em_transporte')
  assert.deepEqual(await (await estoque()).marcarChegadaAction(moto), { ok: false, erro: SEM_PERMISSAO_CHEGADA })
  assert.deepEqual(await estadoDa(moto), intacta('em_transporte', null))
  assert.deepEqual(await historicoDa(moto), [])
})

// D2 do #11: admin_rede sem o botão, embora opere como sócio no resto do app (Montar inclusive).
test('admin_rede não marca a chegada: recusa sem permissão; nada muda', async () => {
  usuarioDaSessao = sessoes.redeA
  const moto = await novaMoto('CHGRED', 'em_transporte')
  assert.deepEqual(await (await estoque()).marcarChegadaAction(moto), { ok: false, erro: SEM_PERMISSAO_CHEGADA })
  assert.deepEqual(await estadoDa(moto), intacta('em_transporte', null))
  assert.deepEqual(await historicoDa(moto), [])
})

test('aux_adm de outra loja da mesma Conta não marca a chegada; nada muda', async () => {
  usuarioDaSessao = sessoes.auxOutraLojaA
  const moto = await novaMoto('CHGOUT', 'em_transporte')
  assert.deepEqual(await (await estoque()).marcarChegadaAction(moto), { ok: false, erro: 'Moto não encontrada' })
  assert.deepEqual(await estadoDa(moto), intacta('em_transporte', null))
})

test('Conta B não marca a chegada de moto da Conta A: a mesma frase do id inexistente; nada muda na A', async () => {
  usuarioDaSessao = sessoes.socioB
  const moto = await novaMoto('CHGCTB', 'em_transporte')
  const { marcarChegadaAction } = await estoque()
  for (const id of [moto, '00000000-0000-4000-8000-000000000011']) {
    assert.deepEqual(await marcarChegadaAction(id), { ok: false, erro: 'Moto não encontrada' }, id)
  }
  assert.deepEqual(await estadoDa(moto), intacta('em_transporte', null))
  assert.deepEqual(await historicoDa(moto), [])
})

test('moto arquivada em transporte: marcar a chegada recusa com a frase de desarquivar; nada muda', async () => {
  usuarioDaSessao = sessoes.auxA
  const moto = await novaMoto('CHGARQ', 'em_transporte')
  await db.execute(sql`update motos set arquivada_em = now(), arquivada_por = ${sessoes.socioA.id}, motivo_arquivo = 'teste' where id = ${moto}`)
  const { MOTO_ARQUIVADA } = await import('@/lib/arquivar-moto-regras')
  assert.deepEqual(await (await estoque()).marcarChegadaAction(moto), { ok: false, erro: MOTO_ARQUIVADA })
  assert.deepEqual(await estadoDa(moto), intacta('em_transporte', null))
})

test('pedido forjado com argumentos a mais: a chegada só leva para Caixa', async () => {
  usuarioDaSessao = sessoes.auxA
  const moto = await novaMoto('CHGFRJ', 'em_transporte')
  const forjada = (await estoque()).marcarChegadaAction as unknown as (...a: unknown[]) => Promise<unknown>
  assert.deepEqual(await forjada(moto, 'montada', { status: 'vendida', usuarioId: sessoes.socioA.id }), { ok: true, dados: undefined })
  assert.deepEqual(await estadoDa(moto), intacta('caixa', null))
  assert.deepEqual(await historicoDa(moto), chegada(sessoes.auxA))
})
