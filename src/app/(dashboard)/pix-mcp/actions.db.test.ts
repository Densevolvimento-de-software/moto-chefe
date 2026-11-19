// Teste de banco: lançar e remover a correspondência de um PIX recebido em /pix-mcp (#90), pelas Server
// Actions de verdade contra o Postgres descartável. Só sessão, cookie do grupo e revalidatePath são simulados.
import { after, before, mock, test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { semearUsuario, type Base } from '@/test/semear-conta'
import { semearContaComAlvos, semearCustoPixDoGrupo, semearPixRecebido } from '@/test/semear-alvos-conciliacao'

const url = process.env.TEST_DATABASE_URL
if (!url || !['localhost', '127.0.0.1'].includes(new URL(url).hostname)) throw new Error('Use somente Postgres descartável local')
process.env.DATABASE_URL = url

type Db = typeof import('@/lib/db')
type Sessao = { id: string; nome: string; papel: string; lojaId: string | null; contaId: string | null; gruposAcesso: string[]; gruposAprovacao: string[] }
let db: Db['db']
let execRows: Db['execRows']
let actions: typeof import('./actions')
let usuario: Sessao

const authMock = mock.module('@/lib/auth', { namedExports: { getUsuarioLogado: async () => usuario } })
const cacheMock = mock.module('next/cache', { namedExports: { revalidatePath: () => {} } })
const headersMock = mock.module('next/headers', { namedExports: { cookies: async () => ({ get: () => undefined }) } })

before(async () => {
  ;({ db, execRows } = await import('@/lib/db'))
  actions = await import('./actions')
})
after(async () => {
  authMock.restore(); cacheMock.restore(); headersMock.restore()
  await (globalThis as { __pgPool?: { end(): Promise<void> } }).__pgPool?.end()
})

const PAGAMENTOS = [{ tipo: 'pix', valor: 1000 }]
const PIX_NAO_ENCONTRADO = { ok: false, erro: 'PIX não encontrado no grupo ativo' }
const um = async <T = Record<string, unknown>>(q: ReturnType<typeof sql>) => (await execRows(q))[0] as T

// Conta com uma venda de moto (com NF), uma OS (com número), o pedido da venda e uma venda de peça.
async function contaComNumeros(nf = String(Math.floor(Math.random() * 1e9)), numeroOs = Math.floor(Math.random() * 1e9)) {
  const conta = await semearContaComAlvos(db, 'PM90', PAGAMENTOS)
  const { moto: venda, os, peca } = conta.alvos
  await db.execute(sql`update vendas set nota_fiscal_saida = ${nf} where id = ${venda}`)
  await db.execute(sql`update ordens_servico set numero = ${numeroOs} where id = ${os}`)
  const pedido = (await um<{ id: string }>(sql`select pedido_venda_id as id from vendas where id = ${venda}`)).id
  const numeros = {
    venda: nf,
    os: String(numeroOs),
    pedido: String((await um<{ n: number }>(sql`select numero as n from pedidos_venda where id = ${pedido}`)).n),
    peca: String((await um<{ n: number }>(sql`select numero as n from vendas_pecas where id = ${peca}`)).n),
  }
  return { ...conta, ids: { venda, os, pedido, peca }, numeros }
}

const sessao = async (b: Base, papel: string): Promise<Sessao> =>
  ({ id: await semearUsuario(db, b, { papel, rotulo: `${papel}-${randomUUID()}` }), nome: `${papel} de teste`, papel, lojaId: b.lojaId, contaId: b.contaId, gruposAcesso: [], gruposAprovacao: [] })

const vinculoDe = (pixId: string) => um(sql`
  select tipo_correspondencia, venda_id, os_id, pedido_id, peca_venda_id, lancado_por_id is not null as lancado
  from pix_recebimentos_mcp where id = ${pixId}`)
const LIVRE = { tipo_correspondencia: null, venda_id: null, os_id: null, pedido_id: null, peca_venda_id: null, lancado: false }
const COLUNA = { venda: 'venda_id', os: 'os_id', pedido: 'pedido_id', peca: 'peca_venda_id' } as const
const TIPOS = ['venda', 'os', 'pedido', 'peca'] as const

test('aux_adm lança e remove a correspondência por NF, OS, pedido e venda de peça', async () => {
  const a = await contaComNumeros()
  usuario = await sessao(a, 'aux_adm')
  for (const tipo of TIPOS) {
    const pix = await semearPixRecebido(db, a.grupoId, { valor: 1000 })
    assert.deepEqual(await actions.lancarCorrespondenciaAction(pix, tipo, a.numeros[tipo]), { ok: true, dados: undefined }, `lança ${tipo}`)
    const v = await vinculoDe(pix)
    assert.equal(v.tipo_correspondencia, tipo)
    assert.equal(v[COLUNA[tipo]], a.ids[tipo], tipo)
    assert.deepEqual(await actions.removerCorrespondenciaAction(pix), { ok: true, dados: undefined }, `remove ${tipo}`)
    assert.deepEqual(await vinculoDe(pix), LIVRE, tipo)
  }
})

test('Conta B: PIX da Conta A (até o de transferência interna) e PIX inexistente recebem a mesma frase, e a A fica intacta', async () => {
  const a = await contaComNumeros()
  usuario = await sessao(a, 'aux_adm')
  const ligado = await semearPixRecebido(db, a.grupoId, { valor: 1000 })
  assert.equal((await actions.lancarCorrespondenciaAction(ligado, 'os', a.numeros.os)).ok, true)
  const interno = await semearPixRecebido(db, a.grupoId, { valor: 1000, pagadorNome: 'MOTOCHEFE LTDA' })
  const comoFicou = await vinculoDe(ligado)

  const b = await contaComNumeros()
  usuario = await sessao(b, 'aux_adm')
  for (const id of [ligado, interno, randomUUID(), 'nao-e-uuid']) {
    assert.deepEqual(await actions.lancarCorrespondenciaAction(id, 'os', b.numeros.os), PIX_NAO_ENCONTRADO, `lança ${id}`)
    assert.deepEqual(await actions.removerCorrespondenciaAction(id), PIX_NAO_ENCONTRADO, `remove ${id}`)
  }
  assert.deepEqual(await vinculoDe(ligado), comoFicou)
  assert.deepEqual(await vinculoDe(interno), LIVRE)
})

test('NF e OS com o mesmo número em outra Conta: liga a da própria Conta', async () => {
  const nf = String(Math.floor(Math.random() * 1e9))
  const numeroOs = Math.floor(Math.random() * 1e9)
  // A outra Conta grava primeiro: sem a Conta no where, a busca pelo número costuma achar a dela.
  await contaComNumeros(nf, numeroOs)
  const a = await contaComNumeros(nf, numeroOs)
  usuario = await sessao(a, 'aux_adm')
  for (const tipo of ['venda', 'os'] as const) {
    const pix = await semearPixRecebido(db, a.grupoId, { valor: 1000 })
    assert.deepEqual(await actions.lancarCorrespondenciaAction(pix, tipo, a.numeros[tipo]), { ok: true, dados: undefined }, tipo)
    assert.equal((await vinculoDe(pix))[COLUNA[tipo]], a.ids[tipo], tipo)
  }
})

// Pedido e venda de peça numeram por uma sequência global: o número da Conta A não existe na B.
test('Conta B lança o número de pedido e de venda de peça que só existe na Conta A: frase do não encontrado e nada grava', async () => {
  const a = await contaComNumeros()
  const b = await contaComNumeros()
  usuario = await sessao(b, 'aux_adm')
  const pix = await semearPixRecebido(db, b.grupoId, { valor: 1000 })
  const nomeB = (await um<{ nome: string }>(sql`select nome from grupos where id = ${b.grupoId}`)).nome
  assert.deepEqual(await actions.lancarCorrespondenciaAction(pix, 'pedido', a.numeros.pedido),
    { ok: false, erro: `Pedido #${a.numeros.pedido} não encontrado no grupo ${nomeB}` })
  assert.deepEqual(await actions.lancarCorrespondenciaAction(pix, 'peca', a.numeros.peca),
    { ok: false, erro: `Venda PA #${a.numeros.peca} não encontrada no grupo ${nomeB}` })
  assert.deepEqual(await vinculoDe(pix), LIVRE)
})

test('PIX de transferência interna do próprio grupo é recusado e nada grava', async () => {
  const a = await contaComNumeros()
  usuario = await sessao(a, 'aux_adm')
  const interno = await semearPixRecebido(db, a.grupoId, { valor: 1000, pagadorNome: 'MOTOCHEFE LTDA' })
  assert.deepEqual(await actions.lancarCorrespondenciaAction(interno, 'venda', a.numeros.venda),
    { ok: false, erro: 'Essa transferência é interna (maquininha/conta do próprio grupo) e não pode ser conciliada com uma venda' })
  assert.deepEqual(await vinculoDe(interno), LIVRE)
})

test('tipo de correspondência fora da lista é recusado e nada grava', async () => {
  const a = await contaComNumeros()
  usuario = await sessao(a, 'aux_adm')
  const pix = await semearPixRecebido(db, a.grupoId, { valor: 1000 })
  for (const tipo of ['xyz', 'moto', ''] as unknown as 'venda'[]) {
    assert.deepEqual(await actions.lancarCorrespondenciaAction(pix, tipo, a.numeros.peca), { ok: false, erro: 'Tipo inválido' }, String(tipo))
  }
  assert.deepEqual(await vinculoDe(pix), LIVRE)
})

// Decisão do Luis (18/11/2026): para trocar o vínculo, desvincula antes.
test('PIX já vinculado não recebe outra correspondência por cima', async () => {
  const a = await contaComNumeros()
  usuario = await sessao(a, 'aux_adm')
  const pix = await semearPixRecebido(db, a.grupoId, { valor: 1000 })
  assert.equal((await actions.lancarCorrespondenciaAction(pix, 'venda', a.numeros.venda)).ok, true)
  const comoFicou = await vinculoDe(pix)
  for (const tipo of TIPOS) {
    assert.deepEqual(await actions.lancarCorrespondenciaAction(pix, tipo, a.numeros[tipo]),
      { ok: false, erro: 'Este PIX já está vinculado. Desvincule antes de vincular de novo.' }, tipo)
  }
  assert.deepEqual(await vinculoDe(pix), comoFicou)
})

test('mecânico recebe Sem permissão ao lançar e ao remover, e nada grava', async () => {
  const a = await contaComNumeros()
  usuario = await sessao(a, 'aux_adm')
  const ligado = await semearPixRecebido(db, a.grupoId, { valor: 1000 })
  assert.equal((await actions.lancarCorrespondenciaAction(ligado, 'peca', a.numeros.peca)).ok, true)
  const comoFicou = await vinculoDe(ligado)
  const livre = await semearPixRecebido(db, a.grupoId, { valor: 1000 })
  usuario = await sessao(a, 'mecanico')
  assert.deepEqual(await actions.lancarCorrespondenciaAction(livre, 'os', a.numeros.os), { ok: false, erro: 'Sem permissão' })
  assert.deepEqual(await actions.removerCorrespondenciaAction(ligado), { ok: false, erro: 'Sem permissão' })
  assert.deepEqual(await vinculoDe(livre), LIVRE)
  assert.deepEqual(await vinculoDe(ligado), comoFicou)
})

// ─── Custo do PIX (#90): o vínculo pela /pix-mcp grava o mesmo que o da conciliação ────────────────

const custoDoGrupo = (grupoId: string, taxa: number) => semearCustoPixDoGrupo(db, grupoId, taxa)
const custoDe = (pixId: string) => um(sql`select valor_bruto, custo_pix, custo_pix_taxa from pix_recebimentos_mcp where id = ${pixId}`)

test('lançar por NF, OS, pedido e venda de peça grava o valor do PIX, o custo e a taxa; mudar a taxa depois não muda; remover limpa', async () => {
  const a = await contaComNumeros()
  await custoDoGrupo(a.grupoId, 0.002)
  usuario = await sessao(a, 'aux_adm')
  const ligados: string[] = []
  for (const tipo of TIPOS) {
    const pix = await semearPixRecebido(db, a.grupoId, { valor: 9980 })
    assert.equal((await actions.lancarCorrespondenciaAction(pix, tipo, a.numeros[tipo])).ok, true, tipo)
    ligados.push(pix)
  }
  await custoDoGrupo(a.grupoId, 0.005)
  for (const pix of ligados) assert.deepEqual(await custoDe(pix), { valor_bruto: '10000.00', custo_pix: '20.00', custo_pix_taxa: '0.002000' })
  assert.equal((await actions.removerCorrespondenciaAction(ligados[0])).ok, true)
  assert.deepEqual(await custoDe(ligados[0]), { valor_bruto: null, custo_pix: null, custo_pix_taxa: null })
})

test('TED lançada pela /pix-mcp grava o crédito inteiro, custo 0 e taxa 0', async () => {
  const a = await contaComNumeros()
  await custoDoGrupo(a.grupoId, 0.002)
  usuario = await sessao(a, 'aux_adm')
  const ted = await semearPixRecebido(db, a.grupoId, { valor: 9980, tipoOperacao: 'TED' })
  assert.equal((await actions.lancarCorrespondenciaAction(ted, 'pedido', a.numeros.pedido)).ok, true)
  assert.deepEqual(await custoDe(ted), { valor_bruto: '9980.00', custo_pix: '0.00', custo_pix_taxa: '0.000000' })
})
