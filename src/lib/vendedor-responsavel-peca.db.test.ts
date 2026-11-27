// Teste de banco (#308): o responsável pela venda de peças, pelas Server Actions de verdade, contra
// o Postgres descartável. A lista do campo é o grupo (CNPJ) da loja da venda; quem registra sempre
// pode deixar a venda no próprio nome; id de outro grupo, de outra Conta e inexistente recebem a
// mesma frase. Só a fronteira de fora é simulada: sessão, cookie do grupo ativo e revalidatePath.
import { after, afterEach, before, mock, test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { semearContaBase, semearGrupo, semearUsuario, type Base } from '@/test/semear-conta'

const url = process.env.TEST_DATABASE_URL
if (!url || !['localhost', '127.0.0.1'].includes(new URL(url).hostname)) throw new Error('Use somente Postgres descartável local')
process.env.DATABASE_URL = url

type Db = typeof import('@/lib/db')
let db: Db['db']
let execRows: Db['execRows']
let vendas: typeof import('@/app/(dashboard)/vendas/actions')
let pecas: typeof import('@/app/(dashboard)/pecas/actions')
let pecasDaConta: typeof import('@/lib/pecas-da-conta')
let saldos: typeof import('@/lib/estoque-pecas-loja')
let usuario: Record<string, unknown> = {}
let grupoAtivoNoCookie: string | null = null

const mocks = [
  mock.module('@/lib/auth', { namedExports: { getUsuarioLogado: async () => usuario } }),
  mock.module('next/cache', { namedExports: { revalidatePath: () => {} } }),
  mock.module('next/headers', {
    namedExports: { cookies: async () => ({ get: (n: string) => (n === 'grupoAtivo' && grupoAtivoNoCookie ? { value: grupoAtivoNoCookie } : undefined) }) },
  }),
]

before(async () => {
  ;({ db, execRows } = await import('@/lib/db'))
  vendas = await import('@/app/(dashboard)/vendas/actions')
  pecas = await import('@/app/(dashboard)/pecas/actions')
  pecasDaConta = await import('@/lib/pecas-da-conta')
  saldos = await import('@/lib/estoque-pecas-loja')
})
afterEach(() => { grupoAtivoNoCookie = null })
after(async () => {
  for (const m of mocks) m.restore()
  await (globalThis as { __pgPool?: { end(): Promise<void> } }).__pgPool?.end()
})

const CPF = '52998224725'
const NAO_ENCONTRADO = 'Vendedor não encontrado'

type Conta = Base & {
  pecaId: string
  auxId: string
  socioId: string
  vendedorId: string
  colegaId: string
  mecanicoId: string
  /** Pessoa de outro grupo (CNPJ) da mesma Conta. */
  deOutroGrupoId: string
  outroGrupoId: string
}

// Conta nova por teste: o que o teste lê é só dele. Dois grupos na mesma Conta.
async function novaConta(): Promise<Conta> {
  const suf = randomUUID()
  const base = await semearContaBase(db, { prefixo: 'RP308', nome: suf, cnpj: suf })
  const outro = await semearGrupo(db, base.contaId, { prefixo: 'RP308', nome: `${suf} outro`, cnpj: `${suf}-2` })
  const baseOutro: Base = { ...base, ...outro }
  const peca = await pecasDaConta.inserirPeca(db, base.contaId, { nome: 'Retrovisor', valor: 50 })
  assert.equal(await saldos.definirSaldo(db, peca.id, base.lojaId, 10), true)
  const socioId = await semearUsuario(db, base, { papel: 'admin_socio', rotulo: 'socio', comGrupo: true, comConta: true, semLoja: true })
  await db.execute(sql`update usuarios set aprova_pagamento_sensivel = true where id = ${socioId}`)
  return {
    ...base,
    pecaId: peca.id,
    auxId: await semearUsuario(db, base, { papel: 'aux_adm', rotulo: 'aux', comGrupo: true, comConta: true }),
    socioId,
    vendedorId: await semearUsuario(db, base, { papel: 'vendedor', comGrupo: true, comConta: true }),
    colegaId: await semearUsuario(db, base, { papel: 'vendedor', rotulo: 'colega', comGrupo: true, comConta: true }),
    mecanicoId: await semearUsuario(db, base, { papel: 'mecanico', comGrupo: true, comConta: true }),
    deOutroGrupoId: await semearUsuario(db, baseOutro, { papel: 'vendedor', rotulo: 'vendedor-outro', comGrupo: true, comConta: true }),
    outroGrupoId: outro.grupoId,
  }
}

type Papel = 'aux_adm' | 'admin_socio' | 'vendedor'
const idDe = (c: Conta, papel: Papel) => ({ aux_adm: c.auxId, admin_socio: c.socioId, vendedor: c.vendedorId })[papel]
const entrarComo = (c: Conta, papel: Papel, extra: Record<string, unknown> = {}) => {
  usuario = {
    id: idDe(c, papel), nome: `${papel} de teste`, email: `${papel}@teste.invalid`, papel,
    lojaId: papel === 'admin_socio' ? null : c.lojaId, contaId: c.contaId, gruposAcesso: [c.grupoId], gruposAprovacao: papel === 'admin_socio' ? [c.grupoId] : [],
    grupoLiberado: null, aprovaPagamentoSensivel: papel === 'admin_socio', ...extra,
  }
  grupoAtivoNoCookie = c.grupoId
}

type Pedido = Parameters<typeof pecas.registrarVendaPecaAction>[0]
const DINHEIRO = [{ tipo: 'dinheiro', valor: 100 }]
const venda = (c: Conta, extra: Record<string, unknown> = {}, pagamentos: object[] = DINHEIRO) =>
  ({ lojaId: c.lojaId, clienteNome: 'Cliente sintético', clienteDocumento: CPF, itens: [{ pecaId: c.pecaId, quantidade: 1 }], pagamentos, ...extra }) as Pedido

const vendasDaLoja = (c: Conta) => execRows(sql`select id, vendedor_id from vendas_pecas where loja_id = ${c.lojaId}`)
const caixaDaLoja = (c: Conta) => execRows(sql`select usuario_id from lancamentos_caixa where loja_id = ${c.lojaId} and venda_peca_id is not null`)

test('aux_adm escolhe uma pessoa do grupo: a venda e o caixa em dinheiro saem no nome dela', async () => {
  const c = await novaConta()
  entrarComo(c, 'aux_adm')
  const r = await pecas.registrarVendaPecaAction(venda(c, { vendedorId: c.colegaId }))
  assert.equal(r.ok, true)
  assert.deepEqual((await vendasDaLoja(c)).map(v => v.vendedor_id), [c.colegaId])
  assert.deepEqual((await caixaDaLoja(c)).map(l => l.usuario_id), [c.colegaId])
})

test('admin_socio sem loja escolhe uma pessoa do grupo da loja da venda', async () => {
  const c = await novaConta()
  entrarComo(c, 'admin_socio')
  assert.equal((await pecas.registrarVendaPecaAction(venda(c, { vendedorId: c.vendedorId }))).ok, true)
  assert.deepEqual((await vendasDaLoja(c)).map(v => v.vendedor_id), [c.vendedorId])
})

test('sem escolher, a venda sai no nome de quem registra', async () => {
  const c = await novaConta()
  entrarComo(c, 'aux_adm')
  assert.equal((await pecas.registrarVendaPecaAction(venda(c))).ok, true)
  assert.deepEqual((await vendasDaLoja(c)).map(v => v.vendedor_id), [c.auxId])
})

test('quem registra escolhe o próprio id mesmo sem ser do grupo da loja: vale', async () => {
  const c = await novaConta()
  // No cadastro o sócio não tem loja nem o grupo (fica fora da lista), mas a sessão o deixa operar a loja:
  // vender no próprio nome segue valendo.
  await db.execute(sql`update usuarios set grupos_acesso = '{}'::uuid[] where id = ${c.socioId}`)
  entrarComo(c, 'admin_socio')
  assert.equal((await pecas.registrarVendaPecaAction(venda(c, { vendedorId: c.socioId }))).ok, true)
  assert.deepEqual((await vendasDaLoja(c)).map(v => v.vendedor_id), [c.socioId])
})

test('pessoa de outro grupo da MESMA Conta é recusada e nada grava', async () => {
  const c = await novaConta()
  entrarComo(c, 'aux_adm')
  const r = await pecas.registrarVendaPecaAction(venda(c, { vendedorId: c.deOutroGrupoId }))
  assert.deepEqual(r, { ok: false, erro: NAO_ENCONTRADO })
  assert.deepEqual(await vendasDaLoja(c), [])
})

test('pessoa de outra Conta e id inexistente recebem a mesma frase, e nada grava', async () => {
  const a = await novaConta()
  const b = await novaConta()
  entrarComo(a, 'aux_adm')
  const deOutraConta = await pecas.registrarVendaPecaAction(venda(a, { vendedorId: b.vendedorId }))
  const inexistente = await pecas.registrarVendaPecaAction(venda(a, { vendedorId: randomUUID() }))
  const doOutroGrupo = await pecas.registrarVendaPecaAction(venda(a, { vendedorId: a.deOutroGrupoId }))
  assert.deepEqual(deOutraConta, { ok: false, erro: NAO_ENCONTRADO })
  assert.deepEqual(inexistente, deOutraConta)
  assert.deepEqual(doOutroGrupo, deOutraConta)
  assert.deepEqual(await vendasDaLoja(a), [])
})

test('papel que não vende peça (mecânico do grupo) não pode ser o responsável', async () => {
  const c = await novaConta()
  entrarComo(c, 'aux_adm')
  assert.deepEqual(await pecas.registrarVendaPecaAction(venda(c, { vendedorId: c.mecanicoId })), { ok: false, erro: NAO_ENCONTRADO })
  assert.deepEqual(await vendasDaLoja(c), [])
})

test('quem não é admin e forja o vendedorId: o id é ignorado e a venda sai no nome dele', async () => {
  const c = await novaConta()
  entrarComo(c, 'vendedor')
  assert.equal((await pecas.registrarVendaPecaAction(venda(c, { vendedorId: c.colegaId }))).ok, true)
  assert.deepEqual((await vendasDaLoja(c)).map(v => v.vendedor_id), [c.vendedorId])
})

test('persona do admin_rede (grupo liberado): só escolhe quem é do grupo da loja', async () => {
  const c = await novaConta()
  entrarComo(c, 'admin_socio', { grupoLiberado: c.grupoId, lojaId: null })
  assert.deepEqual(await pecas.registrarVendaPecaAction(venda(c, { vendedorId: c.deOutroGrupoId })), { ok: false, erro: NAO_ENCONTRADO })
  assert.equal((await pecas.registrarVendaPecaAction(venda(c, { vendedorId: c.colegaId }))).ok, true)
  assert.deepEqual((await vendasDaLoja(c)).map(v => v.vendedor_id), [c.colegaId])
})

const FINANCIAMENTO = [{ tipo: 'financiamento', valor: 500 }]
const aprovacaoDaLoja = (c: Conta) =>
  execRows(sql`select id, vendedor_id, dados_venda from aprovacoes_venda where loja_id = ${c.lojaId} and origem = 'peca'`)

test('financiamento: a aprovação guarda o responsável, nada de campo a mais no pedido, e ao aprovar a venda sai no nome dele', async () => {
  const c = await novaConta()
  entrarComo(c, 'aux_adm')
  const r = await pecas.registrarVendaPecaAction(venda(c, {
    vendedorId: c.colegaId,
    extra: 'x',
    status: 'aprovada',
    itens: [{ pecaId: c.pecaId, quantidade: 1, extra: 'y' }],
  }, FINANCIAMENTO))
  assert.deepEqual(r, { ok: true, dados: { aguardandoAprovacao: true } })
  const [aprovacao] = await aprovacaoDaLoja(c)
  assert.equal(aprovacao.vendedor_id, c.colegaId)
  assert.deepEqual(Object.keys(aprovacao.dados_venda).sort(), ['clienteDocumento', 'clienteNome', 'clienteTipoPessoa', 'itens', 'lojaId', 'pagamentos'])
  assert.deepEqual(aprovacao.dados_venda.itens, [{ pecaId: c.pecaId, quantidade: 1 }])

  entrarComo(c, 'admin_socio')
  const aprovada = await vendas.aprovarVendaAction(aprovacao.id)
  assert.equal(aprovada.ok, true, aprovada.ok ? '' : aprovada.erro)
  assert.deepEqual((await vendasDaLoja(c)).map(v => v.vendedor_id), [c.colegaId])
})

test('financiamento: campo a mais dentro de um pagamento não fica guardado na aprovação', async () => {
  const c = await novaConta()
  entrarComo(c, 'aux_adm')
  const r = await pecas.registrarVendaPecaAction(venda(c, {}, [{ tipo: 'financiamento', valor: 500, extra: 'x', conciliadoManual: { motivo: 'forjado' } }]))
  assert.deepEqual(r, { ok: true, dados: { aguardandoAprovacao: true } })
  const [aprovacao] = await aprovacaoDaLoja(c)
  assert.deepEqual(aprovacao.dados_venda.pagamentos, [{ tipo: 'financiamento', valor: 500 }])
})

test('financiamento com responsável de outro grupo: recusa e nenhuma aprovação fica guardada', async () => {
  const c = await novaConta()
  entrarComo(c, 'aux_adm')
  const r = await pecas.registrarVendaPecaAction(venda(c, { vendedorId: c.deOutroGrupoId }, FINANCIAMENTO))
  assert.deepEqual(r, { ok: false, erro: NAO_ENCONTRADO })
  assert.deepEqual(await aprovacaoDaLoja(c), [])
})
