// Teste de banco: lançar e remover a correspondência de um PIX recebido em /pix-mcp (#90), pelas Server
// Actions de verdade contra o Postgres descartável. Só sessão, cookie do grupo e revalidatePath são simulados.
import { after, before, mock, test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { semearUsuario, type Base } from '@/test/semear-conta'
import { semearContaComAlvos, semearCustoPixDoGrupo, semearPixRecebido } from '@/test/semear-alvos-conciliacao'
import { sessaoDe, type Sessao } from '@/test/sessao'
import { ate, sessaoQueSegura } from '@/test/corrida'

const url = process.env.TEST_DATABASE_URL
if (!url || !['localhost', '127.0.0.1'].includes(new URL(url).hostname)) throw new Error('Use somente Postgres descartável local')
process.env.DATABASE_URL = url

type Db = typeof import('@/lib/db')
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
  sessaoDe(b, papel, await semearUsuario(db, b, { papel, rotulo: `${papel}-${randomUUID()}` }))

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

// ─── Forçada parcial de PIX (#92): desvincular o PIX que a completa ────────────────────────────────

// Venda com pagamentos PIX de 1.000 e de 300; o de 1.000 forçado em parte (base 600) e completado por um PIX
// de 400 vinculado; um PIX de 300 cobre a outra linha.
async function vendaComForcadaParcial(a: Awaited<ReturnType<typeof contaComNumeros>>) {
  const marca = { motivo: 'Resto caiu na conta pessoal', porId: 'u1', porNome: 'Gestor', em: '2026-11-19T12:00:00.000Z',
    pix: { valorRecebido: 598.8, valorBruto: 600, custoPix: 1.2, custoPixTaxa: 0.002 } }
  await db.execute(sql`update vendas set pagamentos = ${JSON.stringify([{ tipo: 'pix', valor: 1000, conciliadoManual: marca }, { tipo: 'pix', valor: 300 }])}::jsonb
    where id = ${a.ids.venda}`)
  const completa = await semearPixRecebido(db, a.grupoId, { valor: 399.2 })
  const outra = await semearPixRecebido(db, a.grupoId, { valor: 300 })
  await db.execute(sql`update pix_recebimentos_mcp set tipo_correspondencia = 'venda', venda_id = ${a.ids.venda}, valor_bruto = 400, custo_pix = 0.8, custo_pix_taxa = 0.002 where id = ${completa}`)
  await db.execute(sql`update pix_recebimentos_mcp set tipo_correspondencia = 'venda', venda_id = ${a.ids.venda} where id = ${outra}`)
  return { completa, outra }
}
const forcadasDe = async (vendaId: string) =>
  (await um<{ n: number }>(sql`select count(*)::int as n from jsonb_array_elements((select pagamentos from vendas where id = ${vendaId})) p where p ? 'conciliadoManual'`)).n

test('remover o PIX que completa a forçada parcial é recusado (o vendedor é mandado a quem gere); o PIX que cobre outra linha remove', async () => {
  const a = await contaComNumeros()
  const { completa, outra } = await vendaComForcadaParcial(a)
  // Quem não gere a conciliação não pode desfazer: a frase manda pedir a quem gere.
  usuario = await sessao(a, 'vendedor')
  assert.deepEqual(await actions.removerCorrespondenciaAction(completa),
    { ok: false, erro: 'Este PIX completa um pagamento marcado como recebido. Peça a quem gere a conciliação para desfazer a forçada.' })
  usuario = await sessao(a, 'aux_adm')
  assert.deepEqual(await actions.removerCorrespondenciaAction(completa),
    { ok: false, erro: 'Este PIX completa um pagamento marcado como recebido. Desfaça a forçada antes de desvincular.' })
  assert.equal((await vinculoDe(completa)).venda_id, a.ids.venda)
  assert.deepEqual(await actions.removerCorrespondenciaAction(outra), { ok: true, dados: undefined })
  assert.deepEqual(await vinculoDe(outra), LIVRE)
})

// B2 da #92: desfazer a forçada e desvincular de uma vez na /pix-mcp. Desfazer a forçada é de quem gere a
// conciliação, como na /conciliacao (#79; decisão do Luis registrada na #92).
test('vendedor chamando direto o desfazer e desvincular recebe Sem permissão, e nada muda', async () => {
  const a = await contaComNumeros()
  const { completa } = await vendaComForcadaParcial(a)
  usuario = await sessao(a, 'vendedor')
  assert.deepEqual(await actions.desfazerForcadaERemoverAction(completa), { ok: false, erro: 'Sem permissão' })
  assert.equal(await forcadasDe(a.ids.venda), 1)
  assert.equal((await vinculoDe(completa)).venda_id, a.ids.venda)
})

// Duas linhas PIX forçadas só em parte: a de 1.000 (base 600) completada por um PIX de 400, a de 300 (base 200)
// por um PIX de 100.
async function vendaComDuasForcadasParciais(a: Awaited<ReturnType<typeof contaComNumeros>>) {
  const marca = (valorBruto: number) => ({ motivo: 'Resto caiu na conta pessoal', porId: 'u1', porNome: 'Gestor', em: '2026-11-19T12:00:00.000Z',
    pix: { valorRecebido: valorBruto, valorBruto, custoPix: 0, custoPixTaxa: 0 } })
  await db.execute(sql`update vendas set pagamentos = ${JSON.stringify([
    { tipo: 'pix', valor: 1000, conciliadoManual: marca(600) }, { tipo: 'pix', valor: 300, conciliadoManual: marca(200) },
  ])}::jsonb where id = ${a.ids.venda}`)
  const ligar = async (valor: number) => {
    const id = await semearPixRecebido(db, a.grupoId, { valor })
    await db.execute(sql`update pix_recebimentos_mcp set tipo_correspondencia = 'venda', venda_id = ${a.ids.venda}, valor_bruto = ${valor} where id = ${id}`)
    return id
  }
  return { de400: await ligar(400), de100: await ligar(100) }
}
const marcasDe = async (vendaId: string) =>
  ((await execRows(sql`select p ? 'conciliadoManual' as m from jsonb_array_elements((select pagamentos from vendas where id = ${vendaId})) p`)) as { m: boolean }[]).map(r => r.m)

test('aux_adm desfaz só a forçada que o PIX completa e desvincula; a outra forçada parcial e o outro PIX ficam', async () => {
  const a = await contaComNumeros()
  const { de400, de100 } = await vendaComDuasForcadasParciais(a)
  usuario = await sessao(a, 'aux_adm')
  assert.deepEqual(await actions.desfazerForcadaERemoverAction(de400), { ok: true, dados: undefined })
  assert.deepEqual(await marcasDe(a.ids.venda), [false, true])
  assert.deepEqual(await vinculoDe(de400), LIVRE)
  assert.equal((await vinculoDe(de100)).venda_id, a.ids.venda)
})

test('desfazer e desvincular um PIX que não completa forçada nenhuma: só desvincula, nenhuma marca muda', async () => {
  const a = await contaComNumeros()
  const { outra } = await vendaComForcadaParcial(a)
  usuario = await sessao(a, 'aux_adm')
  assert.deepEqual(await actions.desfazerForcadaERemoverAction(outra), { ok: true, dados: undefined })
  assert.equal(await forcadasDe(a.ids.venda), 1)
  assert.deepEqual(await vinculoDe(outra), LIVRE)
})

test('desfazer e desvincular numa transação: se soltar o PIX falha, a marca da forçada fica', async () => {
  const a = await contaComNumeros()
  const { completa } = await vendaComForcadaParcial(a)
  // Só este PIX: os arquivos do test:db rodam em paralelo no mesmo banco.
  await db.execute(sql.raw(`create or replace function pix_92_falha() returns trigger language plpgsql as $$ begin raise exception 'falha simulada'; end $$;
    create trigger pix_92_falha before update on pix_recebimentos_mcp for each row when (old.id = '${completa}'::uuid) execute function pix_92_falha();`))
  try {
    usuario = await sessao(a, 'aux_adm')
    await assert.rejects(actions.desfazerForcadaERemoverAction(completa), (e: Error) => /falha simulada/.test(String(e.cause)))
    assert.equal(await forcadasDe(a.ids.venda), 1)
    assert.equal((await vinculoDe(completa)).venda_id, a.ids.venda)
  } finally {
    await db.execute(sql.raw('drop trigger if exists pix_92_falha on pix_recebimentos_mcp; drop function if exists pix_92_falha();'))
  }
})

test('desfazer a forçada e desvincular: PIX de outra Conta recebe a frase do inexistente, e a Conta dona fica intacta', async () => {
  const a = await contaComNumeros()
  const { completa } = await vendaComForcadaParcial(a)
  const b = await contaComNumeros()
  usuario = await sessao(b, 'aux_adm')
  assert.deepEqual(await actions.desfazerForcadaERemoverAction(completa), PIX_NAO_ENCONTRADO)
  assert.equal(await forcadasDe(a.ids.venda), 1)
  assert.equal((await vinculoDe(completa)).venda_id, a.ids.venda)
})

// Bot do #189 (B-P1): duas forçadas parciais disputam o mesmo PIX; soltar o PIX não deixa marca sem o dinheiro.
// T-M3: a forçada cheia ao lado fica.
const marcaDe = (valorBruto?: number) => ({ motivo: 'Teste', porId: 'u1', porNome: 'Gestor', em: '2026-11-19T12:00:00.000Z',
  ...(valorBruto === undefined ? {} : { pix: { valorRecebido: valorBruto, valorBruto, custoPix: 0, custoPixTaxa: 0 } }) })
async function vendaCom(a: Awaited<ReturnType<typeof contaComNumeros>>, pgtos: unknown[], pixValor: number) {
  await db.execute(sql`update vendas set pagamentos = ${JSON.stringify(pgtos)}::jsonb where id = ${a.ids.venda}`)
  const pix = await semearPixRecebido(db, a.grupoId, { valor: pixValor })
  await db.execute(sql`update pix_recebimentos_mcp set tipo_correspondencia = 'venda', venda_id = ${a.ids.venda}, valor_bruto = ${pixValor} where id = ${pix}`)
  return pix
}

test('desfazer e desvincular o PIX que completa duas forçadas que casam com ele pelo valor: as duas marcas saem', async () => {
  const a = await contaComNumeros()
  const pix = await vendaCom(a, [{ tipo: 'pix', valor: 1000, conciliadoManual: marcaDe(900) }, { tipo: 'pix', valor: 500, conciliadoManual: marcaDe(100) }], 500)
  usuario = await sessao(a, 'aux_adm')
  assert.deepEqual(await actions.desfazerForcadaERemoverAction(pix), { ok: true, dados: undefined })
  assert.deepEqual(await marcasDe(a.ids.venda), [false, false])
  assert.deepEqual(await vinculoDe(pix), LIVRE)
})

test('desfazer e desvincular: a forçada cheia ao lado da parcial fica', async () => {
  const a = await contaComNumeros()
  const pix = await vendaCom(a, [{ tipo: 'pix', valor: 1000, conciliadoManual: marcaDe(600) }, { tipo: 'pix', valor: 300, conciliadoManual: marcaDe() }], 400)
  usuario = await sessao(a, 'aux_adm')
  assert.deepEqual(await actions.desfazerForcadaERemoverAction(pix), { ok: true, dados: undefined })
  assert.deepEqual(await marcasDe(a.ids.venda), [false, true])
})

test('desfazer e desvincular lê os pagamentos já com a trava: o que outro pedido gravou enquanto ele esperava fica', async () => {
  const a = await contaComNumeros()
  const { completa } = await vendaComForcadaParcial(a)
  usuario = await sessao(a, 'aux_adm')
  const s = await sessaoQueSegura(url!)
  try {
    await s.travar('select id from vendas where id = $1 for update', [a.ids.venda])
    // Outro pedido, com a venda travada, marca a 2ª linha como recebida (forçada cheia).
    await s.travar(`update vendas set pagamentos = jsonb_set(pagamentos, '{1,conciliadoManual}', $2::jsonb) where id = $1`,
      [a.ids.venda, JSON.stringify({ motivo: 'Outro pedido', porId: 'u2', porNome: 'Gestor', em: '2026-11-19T12:00:00.000Z' })])
    const r = actions.desfazerForcadaERemoverAction(completa)
    await ate(async () => (await s.esperandoPor([s.pid])).length === 1, 'o desfazer esperando a trava da venda')
    await s.soltar()
    assert.deepEqual(await r, { ok: true, dados: undefined })
  } finally { await s.fim() }
  assert.deepEqual(await marcasDe(a.ids.venda), [false, true])
})

// N1: o PIX religado a outro alvo enquanto o desvincular esperava a trava não é solto do alvo novo.
test('desvincular confere o vínculo ao soltar: religado a outro alvo no meio, o PIX fica no alvo novo', async () => {
  const a = await contaComNumeros()
  const pix = await semearPixRecebido(db, a.grupoId, { valor: 1000 })
  await db.execute(sql`update pix_recebimentos_mcp set tipo_correspondencia = 'venda', venda_id = ${a.ids.venda} where id = ${pix}`)
  usuario = await sessao(a, 'aux_adm')
  const s = await sessaoQueSegura(url!)
  let r: Promise<unknown> = Promise.resolve()
  try {
    await s.travar('select id from vendas where id = $1 for update', [a.ids.venda])
    r = actions.removerCorrespondenciaAction(pix)
    await ate(async () => (await s.esperandoPor([s.pid])).length === 1, 'o desvincular esperando a trava da venda')
    await s.travar(`update pix_recebimentos_mcp set tipo_correspondencia = 'os', venda_id = null, os_id = $2 where id = $1`, [pix, a.ids.os])
    await s.soltar()
    assert.deepEqual(await r, PIX_NAO_ENCONTRADO)
  } finally { await s.fim() }
  const v = await vinculoDe(pix)
  assert.deepEqual([v.tipo_correspondencia, v.os_id], ['os', a.ids.os])
})

// A caixa da /pix-mcp: o resumo sai do servidor com as lojas do grupo do PIX.
test('resumo da forçada que o PIX completa: o do próprio grupo; PIX de outra Conta, inexistente ou que não completa = vazio', async () => {
  const a = await contaComNumeros()
  const { completa, outra } = await vendaComForcadaParcial(a)
  usuario = await sessao(a, 'vendedor')
  assert.deepEqual(await actions.forcadaDoPixAction(completa), { ok: true, dados: { linhas: [{ valor: 1000, marcado: 600 }], cobre: 400 } })
  assert.deepEqual(await actions.forcadaDoPixAction(outra), { ok: true, dados: null })
  assert.deepEqual(await actions.forcadaDoPixAction(randomUUID()), { ok: true, dados: null })
  const b = await contaComNumeros()
  usuario = await sessao(b, 'aux_adm')
  assert.deepEqual(await actions.forcadaDoPixAction(completa), { ok: true, dados: null })
})

test('desfazer e desvincular espera a trava do alvo (quem forçar ou desvincular no mesmo alvo espera a vez)', async () => {
  const a = await contaComNumeros()
  const { completa } = await vendaComForcadaParcial(a)
  usuario = await sessao(a, 'aux_adm')
  const s = await sessaoQueSegura(url!)
  try {
    await s.travar('select id from vendas where id = $1 for update', [a.ids.venda])
    const r = actions.desfazerForcadaERemoverAction(completa)
    await ate(async () => (await s.esperandoPor([s.pid])).length === 1, 'o desfazer esperando a trava da venda')
    assert.equal(await forcadasDe(a.ids.venda), 1, 'nada muda enquanto espera')
    await s.soltar()
    assert.deepEqual(await r, { ok: true, dados: undefined })
  } finally { await s.fim() }
  assert.equal(await forcadasDe(a.ids.venda), 0)
  assert.deepEqual(await vinculoDe(completa), LIVRE)
})

test('a trava lê os pagamentos só nas lojas do grupo do PIX: alvo de outro grupo não é lido nem alterado', async () => {
  const a = await contaComNumeros()
  const b = await contaComNumeros()
  const { completa: daB } = await vendaComForcadaParcial(b)
  await db.execute(sql`update pix_recebimentos_mcp set tipo_correspondencia = null, venda_id = null where id = ${daB}`)
  // PIX do grupo A apontando, por dado torto, para a venda da Conta B: é o único que completaria a forçada dela.
  const pix = await semearPixRecebido(db, a.grupoId, { valor: 399.2 })
  await db.execute(sql`update pix_recebimentos_mcp set tipo_correspondencia = 'venda', venda_id = ${b.ids.venda}, valor_bruto = 400 where id = ${pix}`)
  usuario = await sessao(a, 'aux_adm')
  assert.deepEqual(await actions.removerCorrespondenciaAction(pix), { ok: true, dados: undefined })
  assert.equal(await forcadasDe(b.ids.venda), 1, 'a marca da Conta B fica')
})
