// Teste de banco (#151): pedido com campos a mais nos pagamentos, pelas Server Actions de verdade,
// contra o Postgres descartável. Cada pagamento gravado tem só os campos da tela do alvo, e os
// campos que só o servidor grava vêm do registro já gravado, nunca do pedido. Também as aprovações
// guardadas com campos a mais. Só a fronteira de fora é simulada: sessão, cookie do grupo ativo,
// revalidatePath, Kommo e WhatsApp.
import { after, afterEach, before, mock, test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { ate, sessaoQueSegura } from '@/test/corrida'
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
      vendaId: venda, grupoId: outra.grupoId, papel: 'admin_socio', usuarioId: outra.vendedorId,
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

// #220 (D1): aux_adm de grupo com a opção desligada não muda nem tira um pagamento marcado como recebido;
// o pedido forjado com a marca não conta, e a recusa vem com a frase e nada grava.
const FRASE_PAGAMENTO_FORCADO = 'Esse pagamento está marcado como recebido. Peça a quem gere a conciliação para desfazer a forçada.'
const semOpcaoDeForcar = (c: Conta) => db.execute(sql`update grupos set aux_adm_pode_forcar_conciliacao = false where id = ${c.grupoId}`)
const PIX_MUDADO = { tipo: 'pix', valor: 900, conciliadoManual: MARCA_DO_PEDIDO }
const CARTAO_TROCADO = { ...CARTAO, valor: 600 }

test('D1: aux_adm de grupo desligado não muda o valor do pagamento marcado na venda de moto; recusa e nada grava', async () => {
  const c = await novaConta()
  await semOpcaoDeForcar(c)
  const venda = await semearVendaMoto(db, balcao(c), [PIX_FORCADO, CARTAO])
  entrarComo(c, 'aux_adm')
  assert.deepEqual(await vendas.editarVendaAction(venda, edicaoDeMoto([PIX_MUDADO, CARTAO_TROCADO])), { ok: false, erro: FRASE_PAGAMENTO_FORCADO })
  assert.deepEqual(await pagamentosDe('vendas', sql`id = ${venda}`), [[PIX_FORCADO, CARTAO]])
})

test('D1: aux_adm de grupo desligado não tira o pagamento marcado da venda de moto; recusa e nada grava', async () => {
  const c = await novaConta()
  await semOpcaoDeForcar(c)
  const venda = await semearVendaMoto(db, balcao(c), [PIX_FORCADO, CARTAO])
  entrarComo(c, 'aux_adm')
  // Soma continua 1.500 (o total da venda), só sem o PIX marcado.
  const sem = [{ ...CARTAO, valor: 1500 }]
  assert.deepEqual(await vendas.editarVendaAction(venda, edicaoDeMoto(sem)), { ok: false, erro: FRASE_PAGAMENTO_FORCADO })
  assert.deepEqual(await pagamentosDe('vendas', sql`id = ${venda}`), [[PIX_FORCADO, CARTAO]])
})

test('D1: aux_adm de grupo desligado edita só o que não é a marca (parcelas do cartão); a marca fica e grava', async () => {
  const c = await novaConta()
  await semOpcaoDeForcar(c)
  const venda = await semearVendaMoto(db, balcao(c), [PIX_FORCADO, CARTAO])
  entrarComo(c, 'aux_adm')
  ok(await vendas.editarVendaAction(venda, edicaoDeMoto([PIX, { ...CARTAO, parcelas: 4 }])), 'editar parcelas')
  assert.deepEqual(await pagamentosDe('vendas', sql`id = ${venda}`), [[PIX_FORCADO, { ...CARTAO, parcelas: 4 }]])
})

test('D1: aux_adm de grupo desligado não muda o valor do pagamento marcado na venda de peça; recusa e nada grava', async () => {
  const c = await novaConta()
  await semOpcaoDeForcar(c)
  const venda = await semearVendaPeca(db, balcao(c), [PIX_FORCADO, CARTAO])
  entrarComo(c, 'aux_adm')
  assert.deepEqual(await pecas.editarVendaPecaAction(venda, { itens: [{ pecaId: c.pecaId, quantidade: 1 }], pagamentos: [PIX_MUDADO, CARTAO_TROCADO] } as never),
    { ok: false, erro: FRASE_PAGAMENTO_FORCADO })
  assert.deepEqual(await pagamentosDe('vendas_pecas', sql`id = ${venda}`), [[PIX_FORCADO, CARTAO]])
})

test('D1: aux_adm de grupo desligado não muda o valor do pagamento marcado na OS; recusa e nada grava', async () => {
  const c = await novaConta()
  await semOpcaoDeForcar(c)
  const osId = await semearOs(db, balcao(c), [PIX_FORCADO, CARTAO])
  entrarComo(c, 'aux_adm')
  assert.deepEqual(await os.registrarPagamentoOSAction(osId, { valorTotal: 1500, pagamentos: [PIX_MUDADO, CARTAO_TROCADO] } as never),
    { ok: false, erro: FRASE_PAGAMENTO_FORCADO })
  assert.deepEqual(await pagamentosDe('ordens_servico', sql`id = ${osId}`), [[PIX_FORCADO, CARTAO]])
})

test('D1: admin_socio de grupo desligado muda o valor do pagamento marcado (a marca sai, como hoje)', async () => {
  const c = await novaConta()
  await semOpcaoDeForcar(c)
  const venda = await semearVendaMoto(db, balcao(c), [PIX_FORCADO, CARTAO])
  entrarComo(c, 'admin_socio')
  ok(await vendas.editarVendaAction(venda, edicaoDeMoto([PIX_MUDADO, CARTAO_TROCADO])), 'sócio edita')
  assert.deepEqual(await pagamentosDe('vendas', sql`id = ${venda}`), [[{ tipo: 'pix', valor: 900 }, CARTAO_TROCADO]])
})

test('D1: aux_adm de grupo ligado muda o valor do pagamento marcado (comportamento de hoje)', async () => {
  const c = await novaConta()
  const venda = await semearVendaMoto(db, balcao(c), [PIX_FORCADO, CARTAO])
  entrarComo(c, 'aux_adm')
  ok(await vendas.editarVendaAction(venda, edicaoDeMoto([PIX_MUDADO, CARTAO_TROCADO])), 'aux_adm ligado edita')
  assert.deepEqual(await pagamentosDe('vendas', sql`id = ${venda}`), [[{ tipo: 'pix', valor: 900 }, CARTAO_TROCADO]])
})

// #220 (D1) pela aprovação: a edição guardada é aplicada com o papel de quem aprova. O app só deixa aprovar
// admin_geral e admin_socio (aprovacao-permissao.ts), e para eles a D1 nunca recusa; por isso o caso de aux_adm
// é testado na função que aplica, e pela action a barreira de permissão recusa antes de gravar.
test('aprovação de edição de peça com aux_adm de grupo desligado: a função que aplica recusa e nada grava', async () => {
  const c = await novaConta()
  await semOpcaoDeForcar(c)
  const venda = await semearVendaPeca(db, balcao(c), [PIX_FORCADO, CARTAO])
  const { aplicarEdicaoAprovadaTx } = await import('@/lib/editar-venda-peca')
  const edicao = { vendaId: venda, numero: 0, itens: [{ pecaId: c.pecaId, quantidade: 1 }], pagamentos: [PIX_MUDADO, { tipo: 'financiamento', valor: 500 }] }
  await assert.rejects(db.transaction(tx => aplicarEdicaoAprovadaTx(tx, edicao as never, c.vendedorId, 'aux_adm')), { message: FRASE_PAGAMENTO_FORCADO })
  assert.deepEqual(await pagamentosDe('vendas_pecas', sql`id = ${venda}`), [[PIX_FORCADO, CARTAO]])
})

test('aprovação de edição de peça pela action: aux_adm não aprova (barreira de permissão) e a aprovação fica pendente', async () => {
  const c = await novaConta()
  await semOpcaoDeForcar(c)
  const venda = await semearVendaPeca(db, balcao(c), [PIX_FORCADO, CARTAO])
  const aprovacao = await guardarAprovacao(c, {
    origem: 'peca_edicao',
    dadosVenda: { vendaId: venda, numero: 0, itens: [{ pecaId: c.pecaId, quantidade: 1 }], pagamentos: [PIX_MUDADO, { tipo: 'financiamento', valor: 500 }] },
  })
  usuario = { ...sessao(c, 'aux_adm'), aprovaPagamentoSensivel: true }
  grupoAtivoNoCookie = c.grupoId
  assert.deepEqual(await vendas.aprovarVendaAction(aprovacao), { ok: false, erro: 'Sem permissão para aprovar esta venda' })
  const [status] = await execRows(sql`select status from aprovacoes_venda where id = ${aprovacao}`) as { status: string }[]
  assert.equal(status.status, 'pendente')
  assert.deepEqual(await pagamentosDe('vendas_pecas', sql`id = ${venda}`), [[PIX_FORCADO, CARTAO]])
})

// Troca de vendedor depois da venda: só os sócios (admin_geral e admin_socio). O vendedor decide a
// comissão. A tela manda sempre o vendedor atual, então mandar o mesmo vendedor não é troca.
const FRASE_TROCA_VENDEDOR = 'O vendedor da venda só pode ser trocado pelos sócios.'
const vendedorDe = async (venda: string) =>
  (await execRows(sql`select v.vendedor_id as venda, p.vendedor_id as pedido from vendas v join pedidos_venda p on p.id = v.pedido_venda_id where v.id = ${venda}`))[0]

test('aux_adm não troca o vendedor da venda: recusa e nada muda na venda nem no pedido', async () => {
  const c = await novaConta()
  const outra = await semearUsuario(db, c, { papel: 'vendedor', rotulo: 'vendedora2', comGrupo: true })
  const venda = await semearVendaMoto(db, balcao(c), [PIX, CARTAO])
  entrarComo(c, 'aux_adm')
  assert.deepEqual(await vendas.editarVendaAction(venda, { ...edicaoDeMoto([PIX, CARTAO]), vendedorId: outra }),
    { ok: false, erro: FRASE_TROCA_VENDEDOR })
  assert.deepEqual(await vendedorDe(venda), { venda: c.vendedorId, pedido: c.vendedorId })
})

test('aux_adm edita a venda mandando o mesmo vendedor (como a tela manda)', async () => {
  const c = await novaConta()
  const venda = await semearVendaMoto(db, balcao(c), [PIX, CARTAO])
  entrarComo(c, 'aux_adm')
  ok(await vendas.editarVendaAction(venda, { ...edicaoDeMoto([PIX, CARTAO]), vendedorId: c.vendedorId }), 'aux_adm edita')
  assert.deepEqual(await vendedorDe(venda), { venda: c.vendedorId, pedido: c.vendedorId })
})

test('aux_adm não restaura o vendedor anterior se a venda mudar enquanto o diálogo está aberto', async () => {
  const c = await novaConta()
  const novoVendedor = await semearUsuario(db, c, { papel: 'vendedor', rotulo: 'vendedora2', comGrupo: true })
  const venda = await semearVendaMoto(db, balcao(c), [PIX, CARTAO])
  const segura = await sessaoQueSegura(url!)
  let edicao: ReturnType<typeof vendas.editarVendaAction> | undefined
  try {
    await segura.travar('select id from vendas where id = $1 for update', [venda])
    entrarComo(c, 'aux_adm')
    edicao = vendas.editarVendaAction(venda, { ...edicaoDeMoto([PIX, CARTAO]), vendedorId: c.vendedorId })

    await ate(async () => (await segura.esperandoPor([segura.pid])).length > 0, 'a edição esperar a trava da venda')
    await segura.travar('update vendas set vendedor_id = $1 where id = $2', [novoVendedor, venda])
    await segura.travar('update pedidos_venda set vendedor_id = $1 where id = (select pedido_venda_id from vendas where id = $2)', [novoVendedor, venda])
    await segura.soltar()

    assert.deepEqual(await edicao, { ok: false, erro: FRASE_TROCA_VENDEDOR })
    assert.deepEqual(await vendedorDe(venda), { venda: novoVendedor, pedido: novoVendedor })
  } finally {
    await segura.fim().catch(() => {})
    await edicao?.catch(() => {})
  }
})

test('admin_socio troca o vendedor da venda, na venda e no pedido', async () => {
  const c = await novaConta()
  const outra = await semearUsuario(db, c, { papel: 'vendedor', rotulo: 'vendedora2', comGrupo: true })
  const venda = await semearVendaMoto(db, balcao(c), [PIX, CARTAO])
  entrarComo(c, 'admin_socio')
  ok(await vendas.editarVendaAction(venda, { ...edicaoDeMoto([PIX, CARTAO]), vendedorId: outra }), 'sócio troca o vendedor')
  assert.deepEqual(await vendedorDe(venda), { venda: outra, pedido: outra })
})

test('aux_adm com vendedor de outra Conta recebe a mesma recusa e nada muda', async () => {
  const [c, deFora] = [await novaConta(), await novaConta()]
  const venda = await semearVendaMoto(db, balcao(c), [PIX, CARTAO])
  entrarComo(c, 'aux_adm')
  assert.deepEqual(await vendas.editarVendaAction(venda, { ...edicaoDeMoto([PIX, CARTAO]), vendedorId: deFora.vendedorId }),
    { ok: false, erro: FRASE_TROCA_VENDEDOR })
  assert.deepEqual(await vendedorDe(venda), { venda: c.vendedorId, pedido: c.vendedorId })
})

// Toda troca de vendedor vai para o log de ações com quem trocou, a venda e o vendedor anterior e o novo,
// na Conta e no grupo da venda. Mandar o mesmo vendedor (a tela sempre manda) não é troca e não grava.
const logsDaTroca = (venda: string) => execRows(sql`
  select usuario_id, conta_id, grupo_id, detalhe from log_acoes where tipo = 'vendedor_venda_trocado' and detalhe->>'vendaId' = ${venda}`)
const numeroDa = async (venda: string) => (await execRows(sql`select numero from vendas where id = ${venda}`))[0].numero

test('admin_socio troca o vendedor: o log grava quem trocou, a venda e o vendedor anterior e o novo, na Conta da venda', async () => {
  const c = await novaConta()
  const outra = await semearUsuario(db, c, { papel: 'vendedor', rotulo: 'vendedora2', nomeDoUsuario: 'Vendedora Nova', comGrupo: true })
  await db.execute(sql`update usuarios set nome = 'Vendedor Antigo' where id = ${c.vendedorId}`)
  const venda = await semearVendaMoto(db, balcao(c), [PIX, CARTAO])
  entrarComo(c, 'admin_socio')
  ok(await vendas.editarVendaAction(venda, { ...edicaoDeMoto([PIX, CARTAO]), vendedorId: outra }), 'sócio troca o vendedor')
  assert.deepEqual(await logsDaTroca(venda), [{
    usuario_id: c.socioId, conta_id: c.contaId, grupo_id: c.grupoId,
    detalhe: {
      vendaId: venda, numeroVenda: await numeroDa(venda),
      vendedorAnteriorId: c.vendedorId, vendedorAnterior: 'Vendedor Antigo',
      vendedorId: outra, vendedor: 'Vendedora Nova',
    },
  }])
})

test('editar mandando o mesmo vendedor, ou sem vendedor, não grava troca no log', async () => {
  const c = await novaConta()
  const venda = await semearVendaMoto(db, balcao(c), [PIX, CARTAO])
  for (const papel of ['aux_adm', 'admin_socio'] as const) {
    entrarComo(c, papel)
    ok(await vendas.editarVendaAction(venda, { ...edicaoDeMoto([PIX, CARTAO]), vendedorId: c.vendedorId }), `${papel} com o mesmo vendedor`)
    ok(await vendas.editarVendaAction(venda, edicaoDeMoto([PIX, CARTAO])), `${papel} sem vendedor`)
  }
  assert.deepEqual(await logsDaTroca(venda), [])
})

test('troca recusada (aux_adm) não grava no log', async () => {
  const c = await novaConta()
  const outra = await semearUsuario(db, c, { papel: 'vendedor', rotulo: 'vendedora2', comGrupo: true })
  const venda = await semearVendaMoto(db, balcao(c), [PIX, CARTAO])
  entrarComo(c, 'aux_adm')
  assert.deepEqual(await vendas.editarVendaAction(venda, { ...edicaoDeMoto([PIX, CARTAO]), vendedorId: outra }),
    { ok: false, erro: FRASE_TROCA_VENDEDOR })
  assert.deepEqual(await logsDaTroca(venda), [])
})

test('Conta B: sócio não troca o vendedor da venda da Conta A nem põe vendedor de outra Conta, e nada vai ao log', async () => {
  const [a, b] = [await novaConta(), await novaConta()]
  const vendaDeA = await semearVendaMoto(db, balcao(a), [PIX, CARTAO])
  const vendaDeB = await semearVendaMoto(db, balcao(b), [PIX, CARTAO])
  entrarComo(b, 'admin_socio')
  assert.deepEqual(await vendas.editarVendaAction(vendaDeA, { ...edicaoDeMoto([PIX, CARTAO]), vendedorId: b.vendedorId }),
    { ok: false, erro: 'Venda não encontrada' })
  assert.deepEqual(await vendas.editarVendaAction(vendaDeB, { ...edicaoDeMoto([PIX, CARTAO]), vendedorId: a.vendedorId }),
    { ok: false, erro: 'Vendedor não encontrado' })
  assert.deepEqual(await vendedorDe(vendaDeA), { venda: a.vendedorId, pedido: a.vendedorId })
  assert.deepEqual(await vendedorDe(vendaDeB), { venda: b.vendedorId, pedido: b.vendedorId })
  assert.deepEqual([...await logsDaTroca(vendaDeA), ...await logsDaTroca(vendaDeB)], [])
})
