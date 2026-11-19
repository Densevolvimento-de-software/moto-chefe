// Teste de banco (#151): pedido com campos a mais nos pagamentos, pelas Server Actions de verdade,
// contra o Postgres descartável. Cada pagamento gravado tem só os campos da tela do alvo, e os
// campos que só o servidor grava vêm do registro já gravado, nunca do pedido. Também as aprovações
// guardadas com campos a mais. Só a fronteira de fora é simulada: sessão, cookie do grupo ativo,
// revalidatePath, Kommo e WhatsApp.
import { after, afterEach, before, mock, test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { semearContaBase, semearModelo, semearUsuario, type Base } from '@/test/semear-conta'
import { semearOs, semearVendaMoto, semearVendaPeca } from '@/test/semear-alvos-conciliacao'

const url = process.env.TEST_DATABASE_URL
if (!url || !['localhost', '127.0.0.1'].includes(new URL(url).hostname)) throw new Error('Use somente Postgres descartável local')
process.env.DATABASE_URL = url

type Db = typeof import('@/lib/db')
let db: Db['db']
let execRows: Db['execRows']
let vendas: typeof import('@/app/(dashboard)/vendas/actions')
let pecas: typeof import('@/app/(dashboard)/pecas/actions')
let os: typeof import('@/app/(dashboard)/ordens-servico/actions')
let demandas: typeof import('@/app/(dashboard)/demandas/actions')
let pecasDaConta: typeof import('@/lib/pecas-da-conta')
let saldos: typeof import('@/lib/estoque-pecas-loja')
let editarVendaPecaTx: typeof import('@/lib/editar-venda-peca')['editarVendaPecaTx']
let aplicarPagamentoOS: typeof import('@/lib/pagamento-os')['aplicarPagamentoOS']
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
  pecas = await import('@/app/(dashboard)/pecas/actions')
  os = await import('@/app/(dashboard)/ordens-servico/actions')
  demandas = await import('@/app/(dashboard)/demandas/actions')
  pecasDaConta = await import('@/lib/pecas-da-conta')
  saldos = await import('@/lib/estoque-pecas-loja')
  ;({ editarVendaPecaTx } = await import('@/lib/editar-venda-peca'))
  ;({ aplicarPagamentoOS } = await import('@/lib/pagamento-os'))
})
afterEach(() => { grupoAtivoNoCookie = null })
after(async () => {
  for (const m of mocks) m.restore()
  await (globalThis as { __pgPool?: { end(): Promise<void> } }).__pgPool?.end()
})

const CPF = '52998224725'
const OPERADORA = 'op-151'
const MARCA_GRAVADA = { motivo: 'caiu na conta', porId: randomUUID(), porNome: 'Gestor', em: '2026-11-01T12:00:00.000Z' }
const MARCA_DO_PEDIDO = { motivo: 'qualquer', porId: randomUUID(), porNome: 'Outro', em: '2026-11-02T12:00:00.000Z' }
const PIX = { tipo: 'pix', valor: 1000 }
const CARTAO = { tipo: 'cartao_credito', valor: 500, operadora: OPERADORA, parcelas: 3, autorizacao: 'A1B2' }
const comCamposAMais = <T extends object>(p: T) => ({ ...p, conciliadoManual: MARCA_DO_PEDIDO, extra: 'x' })
const PEDIDO = [comCamposAMais(PIX), comCamposAMais(CARTAO)]
const ESPERADO = [PIX, CARTAO]
const PIX_FORCADO = { ...PIX, conciliadoManual: MARCA_GRAVADA }

type Conta = Base & { vendedorId: string; auxId: string; socioId: string; modeloId: string; origemId: string; pecaId: string }

// Conta nova por teste: o que o teste lê é só dele.
async function novaConta(): Promise<Conta> {
  const suf = randomUUID()
  const base = await semearContaBase(db, { prefixo: 'PG151', nome: suf, cnpj: suf })
  const vendedorId = await semearUsuario(db, base, { papel: 'vendedor', comGrupo: true })
  const auxId = await semearUsuario(db, base, { papel: 'aux_adm', comGrupo: true })
  const socioId = await semearUsuario(db, base, { papel: 'admin_socio', rotulo: 'socio', comGrupo: true })
  await db.execute(sql`update usuarios set aprova_pagamento_sensivel = true where id = ${socioId}`)
  await db.execute(sql`insert into maquininhas (grupo_id, nome, operadora) values (${base.grupoId}, 'Maquininha', ${OPERADORA})`)
  const [origem] = await execRows(sql`insert into origens_venda (grupo_id, nome) values (${base.grupoId}, 'Loja') returning id`)
  const peca = await pecasDaConta.inserirPeca(db, base.contaId, { nome: 'Retrovisor', valor: 50 })
  assert.equal(await saldos.definirSaldo(db, peca.id, base.lojaId, 10), true)
  return { ...base, vendedorId, auxId, socioId, modeloId: await semearModelo(db, 'PG151 ' + suf), origemId: origem.id, pecaId: peca.id }
}

const sessao = (c: Conta, papel: 'vendedor' | 'aux_adm' | 'admin_socio') => ({
  id: { vendedor: c.vendedorId, aux_adm: c.auxId, admin_socio: c.socioId }[papel],
  nome: `${papel} de teste`,
  email: `${papel}@teste.invalid`,
  papel,
  lojaId: c.lojaId,
  contaId: c.contaId,
  gruposAcesso: [c.grupoId],
  gruposAprovacao: [],
  grupoLiberado: null,
  aprovaPagamentoSensivel: papel === 'admin_socio',
})
const entrarComo = (c: Conta, papel: Parameters<typeof sessao>[1]) => {
  usuario = sessao(c, papel)
  grupoAtivoNoCookie = c.grupoId
}

async function novaMoto(c: Conta) {
  const [m] = await execRows(sql`insert into motos (chassi, modelo_id, loja_id, cor, nota_fiscal_entrada, status, disponibilidade)
    values (${'PG151' + randomUUID()}, ${c.modeloId}, ${c.lojaId}, 'CINZA', '1', 'montada', 'disponivel') returning id`)
  return m.id as string
}

const cliente = { clienteNome: 'Cliente sintético', clienteCpf: CPF, clienteCelular: '35999990151', clienteEmail: 'c@teste.invalid',
  clienteCep: '', clienteLogradouro: '', clienteNumero: '', clienteComplemento: '', clienteBairro: '', clienteCidade: '', clienteEstado: '' }
const vendaDeMoto = (c: Conta, motoId: string, pagamentos: object[]) =>
  ({ motoId, ...cliente, valorTotal: '1500.00', origemId: c.origemId, pagamentos }) as Parameters<typeof vendas.registrarVendaCompletaAction>[0]
const vendaDePeca = (c: Conta, pagamentos: object[]) =>
  ({ lojaId: c.lojaId, clienteNome: 'Cliente sintético', clienteDocumento: CPF, itens: [{ pecaId: c.pecaId, quantidade: 1 }], pagamentos }) as
    Parameters<typeof pecas.registrarVendaPecaAction>[0]
const balcao = (c: Conta) => ({ lojaId: c.lojaId, usuarioId: c.vendedorId, modeloId: c.modeloId })

const pagamentosDe = async (tabela: 'vendas' | 'vendas_pecas' | 'ordens_servico' | 'reservas' | 'demandas', where: ReturnType<typeof sql>) =>
  (await execRows(sql`select pagamentos from ${sql.raw(tabela)} where ${where}`)).map(r => r.pagamentos)

async function guardarAprovacao(c: Conta, campos: { origem: string; motoId?: string; osId?: string; dadosVenda: object }) {
  const [a] = await execRows(sql`insert into aprovacoes_venda (origem, moto_id, os_id, loja_id, vendedor_id, valor, dados_venda, motivo, tipo)
    values (${campos.origem}, ${campos.motoId ?? null}, ${campos.osId ?? null}, ${c.lojaId}, ${c.vendedorId}, 1500,
      ${JSON.stringify(campos.dadosVenda)}::jsonb, 'teste', 'pagamento_sensivel') returning id`)
  return a.id as string
}

const ok = (r: { ok: boolean; erro?: string }, onde: string) => assert.equal(r.ok, true, `${onde}: ${r.ok ? '' : r.erro}`)

test('criar venda de moto: pedido com campos a mais grava só os campos da tela', async () => {
  const c = await novaConta()
  const moto = await novaMoto(c)
  entrarComo(c, 'vendedor')
  ok(await vendas.registrarVendaCompletaAction(vendaDeMoto(c, moto, PEDIDO)), 'venda')
  assert.deepEqual(await pagamentosDe('vendas', sql`moto_id = ${moto}`), [ESPERADO])
})

test('criar venda de peça: pedido com campos a mais grava só os campos da tela', async () => {
  const c = await novaConta()
  entrarComo(c, 'vendedor')
  ok(await pecas.registrarVendaPecaAction(vendaDePeca(c, PEDIDO)), 'venda de peça')
  assert.deepEqual(await pagamentosDe('vendas_pecas', sql`loja_id = ${c.lojaId}`), [ESPERADO])
})

test('pagamento da OS: pedido com campos a mais grava só os campos da tela', async () => {
  const c = await novaConta()
  const osId = await semearOs(db, balcao(c), [])
  entrarComo(c, 'aux_adm')
  ok(await os.registrarPagamentoOSAction(osId, { valorTotal: 1500, pagamentos: PEDIDO } as never), 'pagamento da OS')
  assert.deepEqual(await pagamentosDe('ordens_servico', sql`id = ${osId}`), [ESPERADO])
})

const ENTRADA = [PIX, { tipo: 'cartao_credito', valor: 500, operadora: OPERADORA, parcelas: 3 }]
const demandaSemSinal = (c: Conta) => ({ modelo: 'Modelo', modeloId: null, cor: 'Preta', lojaId: c.lojaId }) as Parameters<typeof demandas.criarDemandaAction>[0]
const sinal = { ...cliente, valorSinal: 1500, pagamentos: PEDIDO } as Parameters<typeof demandas.marcarSinalDemandaAction>[1]

test('entrada da reserva: pedido com campos a mais grava só tipo, valor, operadora e parcelas', async () => {
  const c = await novaConta()
  const moto = await novaMoto(c)
  entrarComo(c, 'vendedor')
  ok(await vendas.registrarReservaAction({
    motoId: moto, ...cliente, valorReserva: '1500.00', valorTotalVenda: '10000.00', pagamentos: PEDIDO, dataPrevistaFinalizacao: '2026-12-01',
  } as never), 'reserva')
  assert.deepEqual(await pagamentosDe('reservas', sql`moto_id = ${moto}`), [ENTRADA])
})

test('criar demanda com sinal: pedido com campos a mais grava só tipo, valor, operadora e parcelas', async () => {
  const c = await novaConta()
  entrarComo(c, 'vendedor')
  const { id } = await demandas.criarDemandaAction({ ...demandaSemSinal(c), sinal })
  assert.deepEqual(await pagamentosDe('demandas', sql`id = ${id}`), [ENTRADA])
})

test('marcar o sinal da demanda: pedido com campos a mais grava só tipo, valor, operadora e parcelas', async () => {
  const c = await novaConta()
  entrarComo(c, 'vendedor')
  const { id } = await demandas.criarDemandaAction(demandaSemSinal(c))
  await demandas.marcarSinalDemandaAction(id, sinal)
  assert.deepEqual(await pagamentosDe('demandas', sql`id = ${id}`), [ENTRADA])
})

test('aprovação de venda de moto guardada com campos a mais grava só os campos da tela ao aprovar', async () => {
  const c = await novaConta()
  const moto = await novaMoto(c)
  const aprovacao = await guardarAprovacao(c, { origem: 'moto', motoId: moto, dadosVenda: vendaDeMoto(c, moto, PEDIDO) })
  entrarComo(c, 'admin_socio')
  ok(await vendas.aprovarVendaAction(aprovacao), 'aprovar moto')
  assert.deepEqual(await pagamentosDe('vendas', sql`moto_id = ${moto}`), [ESPERADO])
})

test('aprovação de venda de peça guardada com campos a mais grava só os campos da tela ao aprovar', async () => {
  const c = await novaConta()
  const aprovacao = await guardarAprovacao(c, { origem: 'peca', dadosVenda: vendaDePeca(c, PEDIDO) })
  entrarComo(c, 'admin_socio')
  ok(await vendas.aprovarVendaAction(aprovacao), 'aprovar peça')
  assert.deepEqual(await pagamentosDe('vendas_pecas', sql`loja_id = ${c.lojaId}`), [ESPERADO])
})

test('aprovação de pagamento da OS guardada com campos a mais grava só os campos da tela ao aprovar', async () => {
  const c = await novaConta()
  const osId = await semearOs(db, balcao(c), [])
  const aprovacao = await guardarAprovacao(c, { origem: 'os', osId, dadosVenda: { valorTotal: 1500, pagamentos: PEDIDO } })
  entrarComo(c, 'admin_socio')
  ok(await vendas.aprovarVendaAction(aprovacao), 'aprovar OS')
  assert.deepEqual(await pagamentosDe('ordens_servico', sql`id = ${osId}`), [ESPERADO])
})

const edicaoDeMoto = (pagamentos: object[]) =>
  ({ valor: '1500.00', dataVenda: '2026-11-10', pagamentos, clienteNome: 'Cliente sintético', clienteCpf: CPF }) as Parameters<typeof vendas.editarVendaAction>[1]

test('editar venda de moto como o diálogo manda (sem a marca) mantém a marca gravada', async () => {
  const c = await novaConta()
  const venda = await semearVendaMoto(db, balcao(c), [PIX_FORCADO, CARTAO])
  entrarComo(c, 'aux_adm')
  ok(await vendas.editarVendaAction(venda, edicaoDeMoto([PIX, CARTAO])), 'editar venda')
  assert.deepEqual(await pagamentosDe('vendas', sql`id = ${venda}`), [[PIX_FORCADO, CARTAO]])
})

test('editar venda de moto com outra marca no pedido mantém a marca gravada', async () => {
  const c = await novaConta()
  const venda = await semearVendaMoto(db, balcao(c), [PIX_FORCADO, CARTAO])
  entrarComo(c, 'aux_adm')
  ok(await vendas.editarVendaAction(venda, edicaoDeMoto(PEDIDO)), 'editar venda')
  assert.deepEqual(await pagamentosDe('vendas', sql`id = ${venda}`), [[PIX_FORCADO, CARTAO]])
})

test('editar venda de moto de outra Conta: "Venda não encontrada" e nada muda nela', async () => {
  const [c, outra] = [await novaConta(), await novaConta()]
  const vendaDaOutra = await semearVendaMoto(db, balcao(outra), [PIX_FORCADO, CARTAO])
  entrarComo(c, 'aux_adm')
  assert.deepEqual(await vendas.editarVendaAction(vendaDaOutra, edicaoDeMoto(PEDIDO)), { ok: false, erro: 'Venda não encontrada' })
  assert.deepEqual(await pagamentosDe('vendas', sql`id = ${vendaDaOutra}`), [[PIX_FORCADO, CARTAO]])
})

test('editar venda de peça mantém a marca gravada; a do pedido não entra', async () => {
  const c = await novaConta()
  const venda = await semearVendaPeca(db, balcao(c), [PIX_FORCADO, CARTAO])
  entrarComo(c, 'vendedor')
  ok(await pecas.editarVendaPecaAction(venda, { itens: [{ pecaId: c.pecaId, quantidade: 1 }], pagamentos: PEDIDO } as never), 'editar peça')
  assert.deepEqual(await pagamentosDe('vendas_pecas', sql`id = ${venda}`), [[PIX_FORCADO, CARTAO]])
})

test('edição de peça aprovada: o PIX igual mantém a marca gravada e a linha nova entra sem a do pedido', async () => {
  const c = await novaConta()
  const venda = await semearVendaPeca(db, balcao(c), [PIX_FORCADO, CARTAO])
  const financiamento = { tipo: 'financiamento', valor: 500 }
  const aprovacao = await guardarAprovacao(c, {
    origem: 'peca_edicao',
    dadosVenda: { vendaId: venda, numero: 0, itens: [{ pecaId: c.pecaId, quantidade: 1 }], pagamentos: [PIX, comCamposAMais(financiamento)] },
  })
  entrarComo(c, 'admin_socio')
  ok(await vendas.aprovarVendaAction(aprovacao), 'aprovar edição de peça')
  assert.deepEqual(await pagamentosDe('vendas_pecas', sql`id = ${venda}`), [[PIX_FORCADO, financiamento]])
})

test('reeditar o pagamento da OS mantém a marca gravada; a do pedido não entra', async () => {
  const c = await novaConta()
  const osId = await semearOs(db, balcao(c), [PIX_FORCADO, CARTAO])
  entrarComo(c, 'aux_adm')
  ok(await os.registrarPagamentoOSAction(osId, { valorTotal: 1500, pagamentos: PEDIDO } as never), 'reeditar OS')
  assert.deepEqual(await pagamentosDe('ordens_servico', sql`id = ${osId}`), [[PIX_FORCADO, CARTAO]])
})

test('edição de venda de peça com o grupo de outra Conta: "Venda não encontrada" e nada muda', async () => {
  const [c, outra] = [await novaConta(), await novaConta()]
  const venda = await semearVendaPeca(db, balcao(c), [PIX_FORCADO, CARTAO])
  await assert.rejects(
    db.transaction(tx => editarVendaPecaTx(tx, {
      vendaId: venda, grupoId: outra.grupoId, usuarioId: outra.vendedorId,
      itens: [{ pecaId: c.pecaId, quantidade: 1 }], pagamentos: [{ tipo: 'dinheiro', valor: 1500 }],
    })),
    /Venda não encontrada/,
  )
  assert.deepEqual(await pagamentosDe('vendas_pecas', sql`id = ${venda}`), [[PIX_FORCADO, CARTAO]])
})

test('pagamento da OS com a loja de outra Conta: "OS não encontrada" e nada muda', async () => {
  const [c, outra] = [await novaConta(), await novaConta()]
  const osId = await semearOs(db, balcao(c), [PIX_FORCADO, CARTAO])
  entrarComo(outra, 'aux_adm')
  await assert.rejects(
    aplicarPagamentoOS({ id: osId, lojaId: outra.lojaId }, { valorTotal: 1500, pagamentos: [{ tipo: 'dinheiro', valor: 1500 }] }),
    /OS não encontrada/,
  )
  assert.deepEqual(await pagamentosDe('ordens_servico', sql`id = ${osId}`), [[PIX_FORCADO, CARTAO]])
})
