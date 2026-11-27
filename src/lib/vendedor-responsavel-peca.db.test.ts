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

const aprovacaoDaLoja = (c: Conta) =>
  execRows(sql`select id, vendedor_id, dados_venda from aprovacoes_venda where loja_id = ${c.lojaId} and origem = 'peca'`)
const saldoDaPeca = async (c: Conta) => Number((await execRows(sql`select quantidade from pecas_estoque_loja where peca_id = ${c.pecaId} and loja_id = ${c.lojaId}`))[0].quantidade)
// O que uma recusa não pode mexer: venda, saldo, caixa e aprovação da loja.
const estadoDaLoja = async (c: Conta) => ({
  vendas: await vendasDaLoja(c), saldo: await saldoDaPeca(c), caixa: await caixaDaLoja(c), aprovacoes: await aprovacaoDaLoja(c),
})
const SEM_MEXER = (saldo: number) => ({ vendas: [], saldo, caixa: [], aprovacoes: [] })
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

test('admin_geral fora de todo grupo escolhe o próprio id: vale, mesmo ele não estando na lista do grupo', async () => {
  const c = await novaConta()
  // admin_geral não tem loja, Conta nem grupo no cadastro: fica fora da lista de propósito (usuarios-do-grupo.ts).
  const geralId = await semearUsuario(db, c, { papel: 'admin_geral', rotulo: 'geral', semLoja: true })
  usuario = {
    id: geralId, nome: 'admin_geral de teste', email: 'geral@teste.invalid', papel: 'admin_geral', lojaId: null, contaId: null,
    gruposAcesso: [], gruposAprovacao: [], grupoLiberado: null, aprovaPagamentoSensivel: true,
  }
  grupoAtivoNoCookie = c.grupoId
  const { listarUsuariosDoGrupo } = await import('@/lib/usuarios-do-grupo')
  assert.equal((await listarUsuariosDoGrupo(c.grupoId)).some(u => u.id === geralId), false)
  const r = await pecas.registrarVendaPecaAction(venda(c, { vendedorId: geralId }))
  assert.equal(r.ok, true, r.ok ? '' : r.erro)
  assert.deepEqual((await vendasDaLoja(c)).map(v => v.vendedor_id), [geralId])
})

test('pessoa de outro grupo da MESMA Conta é recusada e nada grava', async () => {
  const c = await novaConta()
  entrarComo(c, 'aux_adm')
  const r = await pecas.registrarVendaPecaAction(venda(c, { vendedorId: c.deOutroGrupoId }))
  assert.deepEqual(r, { ok: false, erro: NAO_ENCONTRADO })
  assert.deepEqual(await estadoDaLoja(c), SEM_MEXER(10))
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
  assert.deepEqual(await estadoDaLoja(a), SEM_MEXER(10))
})

test('papel que não vende peça (mecânico do grupo) não pode ser o responsável', async () => {
  const c = await novaConta()
  entrarComo(c, 'aux_adm')
  assert.deepEqual(await pecas.registrarVendaPecaAction(venda(c, { vendedorId: c.mecanicoId })), { ok: false, erro: NAO_ENCONTRADO })
  assert.deepEqual(await estadoDaLoja(c), SEM_MEXER(10))
})

test('quem não é admin e forja o vendedorId: o id é ignorado e a venda sai no nome dele', async () => {
  const c = await novaConta()
  entrarComo(c, 'vendedor')
  assert.equal((await pecas.registrarVendaPecaAction(venda(c, { vendedorId: c.colegaId }))).ok, true)
  assert.deepEqual((await vendasDaLoja(c)).map(v => v.vendedor_id), [c.vendedorId])
})

// admin_rede de OUTRA Conta, pela usuarioDaRede de verdade (src/lib/grupos-liberados.ts): vira admin_socio e, com o
// grupo da Conta A liberado e ativo, a persona daquele grupo, com o id dele, que é da Conta B.
async function entrarComoAdminRede(propria: Conta, alvo: Conta, { liberado }: { liberado: boolean }) {
  const { usuarioDaRede } = await import('@/lib/grupos-liberados')
  const id = await semearUsuario(db, propria, { papel: 'admin_rede', rotulo: 'rede', comConta: true, semLoja: true })
  const doCadastro = {
    id, nome: 'admin_rede de teste', email: 'rede@teste.invalid', papel: 'admin_rede', lojaId: null, contaId: propria.contaId,
    gruposAcesso: [propria.grupoId], gruposAprovacao: [], aprovaPagamentoSensivel: false,
  }
  usuario = usuarioDaRede(doCadastro, liberado ? [{ grupoId: alvo.grupoId, contaId: alvo.contaId }] : [], alvo.grupoId)
  grupoAtivoNoCookie = alvo.grupoId
  return id
}

test('admin_rede de outra Conta em grupo liberado: escolhe quem é do grupo liberado e não quem é da Conta dele', async () => {
  const a = await novaConta()
  const b = await novaConta()
  const redeId = await entrarComoAdminRede(b, a, { liberado: true })
  assert.deepEqual(await pecas.registrarVendaPecaAction(venda(a, { vendedorId: b.vendedorId })), { ok: false, erro: NAO_ENCONTRADO })
  assert.deepEqual(await pecas.registrarVendaPecaAction(venda(a, { vendedorId: a.deOutroGrupoId })), { ok: false, erro: NAO_ENCONTRADO })
  assert.equal((await pecas.registrarVendaPecaAction(venda(a, { vendedorId: a.colegaId }))).ok, true)
  assert.equal((await pecas.registrarVendaPecaAction(venda(a))).ok, true)
  assert.deepEqual((await vendasDaLoja(a)).map(v => v.vendedor_id).sort(), [a.colegaId, redeId].sort())
})

test('admin_rede sem o grupo liberado: não vende peça na loja de outra Conta, nem escolhendo ninguém', async () => {
  const a = await novaConta()
  const b = await novaConta()
  await entrarComoAdminRede(b, a, { liberado: false })
  const semEscolher = await pecas.registrarVendaPecaAction(venda(a))
  const escolhendo = await pecas.registrarVendaPecaAction(venda(a, { vendedorId: a.colegaId }))
  assert.deepEqual(semEscolher, { ok: false, erro: 'Sem permissão para esta loja' })
  assert.deepEqual(escolhendo, semEscolher)
  assert.deepEqual(await estadoDaLoja(a), SEM_MEXER(10))
})

const FINANCIAMENTO = [{ tipo: 'financiamento', valor: 500 }]

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

test('financiamento: pagamento legítimo completo (parcelas, operadora, autorização) fica guardado como veio', async () => {
  const c = await novaConta()
  entrarComo(c, 'aux_adm')
  const pagamento = { tipo: 'financiamento', valor: 500, operadora: 'op-308', parcelas: 3, autorizacao: 'A1B2' }
  assert.equal((await pecas.registrarVendaPecaAction(venda(c, {}, [pagamento]))).ok, true)
  const [aprovacao] = await aprovacaoDaLoja(c)
  assert.deepEqual(aprovacao.dados_venda.pagamentos, [pagamento])
})

test('financiamento: o preço ajustado só fica guardado quando quem registra é gestor', async () => {
  const c = await novaConta()
  const itens = [{ pecaId: c.pecaId, quantidade: 1, valorUnitario: 40 }]
  entrarComo(c, 'aux_adm')
  assert.equal((await pecas.registrarVendaPecaAction(venda(c, { itens }, FINANCIAMENTO))).ok, true)
  entrarComo(c, 'vendedor')
  assert.equal((await pecas.registrarVendaPecaAction(venda(c, { itens }, FINANCIAMENTO))).ok, true)
  const guardados = (await aprovacaoDaLoja(c)).map(a => a.dados_venda.itens)
  assert.deepEqual(guardados.map(i => i[0].valorUnitario).sort(), [40, undefined])
})

test('financiamento: preço ajustado que não é número não fica guardado, nem para gestor', async () => {
  const c = await novaConta()
  entrarComo(c, 'aux_adm')
  const itens = [{ pecaId: c.pecaId, quantidade: 1, valorUnitario: '40' }]
  assert.equal((await pecas.registrarVendaPecaAction(venda(c, { itens }, FINANCIAMENTO))).ok, true)
  assert.deepEqual((await aprovacaoDaLoja(c)).map(a => a.dados_venda.itens), [[{ pecaId: c.pecaId, quantidade: 1 }]])
})

test('financiamento com responsável de outro grupo: recusa e nenhuma aprovação fica guardada', async () => {
  const c = await novaConta()
  entrarComo(c, 'aux_adm')
  const r = await pecas.registrarVendaPecaAction(venda(c, { vendedorId: c.deOutroGrupoId }, FINANCIAMENTO))
  assert.deepEqual(r, { ok: false, erro: NAO_ENCONTRADO })
  assert.deepEqual(await estadoDaLoja(c), SEM_MEXER(10))
})

test('as opções do campo Responsável são exatamente quem o servidor aceita, e nada da outra Conta aparece', async () => {
  const a = await novaConta()
  const b = await novaConta()
  const { listarUsuariosDoGrupo } = await import('@/lib/usuarios-do-grupo')
  const { opcoesDeResponsavel } = await import('@/lib/vendedor-escolhido')
  const { PAPEIS_VENDA_PECA } = await import('@/app/(dashboard)/pecas/papeis')
  // Como a página monta o campo: a lista do grupo da loja, pela mesma função do servidor, e as opções da tela.
  const lojasDoGrupo = await execRows(sql`select id, nome from lojas where grupo_id = ${a.grupoId}`) as { id: string; nome: string }[]
  const doGrupo = await listarUsuariosDoGrupo(a.grupoId, { papeis: PAPEIS_VENDA_PECA })
  const opcoes = opcoesDeResponsavel(doGrupo, lojasDoGrupo, { id: a.auxId, nome: 'aux', lojaId: a.lojaId }).map(o => o.id)
  const deA = [a.auxId, a.socioId, a.vendedorId, a.colegaId, a.mecanicoId, a.deOutroGrupoId]
  const deB = [b.auxId, b.socioId, b.vendedorId, b.colegaId, b.mecanicoId, b.deOutroGrupoId]
  assert.equal(deB.some(id => opcoes.includes(id)), false)
  // O servidor aceita quem está nas opções; quem registra (o aux_adm) fica sempre aceito, é ele.
  entrarComo(a, 'aux_adm')
  const aceitos: string[] = []
  for (const id of [...deA, ...deB]) {
    if (id === a.auxId) continue
    if ((await pecas.registrarVendaPecaAction(venda(a, { vendedorId: id }))).ok) aceitos.push(id)
  }
  assert.deepEqual(aceitos.sort(), opcoes.filter(id => id !== a.auxId).sort())
})

test('loja de outra Conta e loja inexistente: mesma recusa, com ou sem responsável, e nada muda nas duas Contas', async () => {
  const a = await novaConta()
  const b = await novaConta()
  entrarComo(a, 'aux_adm')
  const deOutraConta = await pecas.registrarVendaPecaAction(venda(a, { lojaId: b.lojaId, vendedorId: a.colegaId }))
  const semResponsavel = await pecas.registrarVendaPecaAction(venda(a, { lojaId: b.lojaId }))
  const inexistente = await pecas.registrarVendaPecaAction(venda(a, { lojaId: randomUUID(), vendedorId: a.colegaId }))
  assert.deepEqual(deOutraConta, { ok: false, erro: 'Sem permissão para esta loja' })
  assert.deepEqual(semResponsavel, deOutraConta)
  assert.deepEqual(inexistente, deOutraConta)
  assert.deepEqual(await estadoDaLoja(a), SEM_MEXER(10))
  assert.deepEqual(await estadoDaLoja(b), SEM_MEXER(10))
})
