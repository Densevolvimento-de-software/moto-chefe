// Teste de banco: cartão estornado (Mercado Pago) não é pendência, não é candidato a vínculo e o
// servidor recusa vinculá-lo. Roda as funções de verdade contra o Postgres descartável; só a sessão,
// o cookie e o cache do Next são simulados (fronteira de fora).
import { after, before, mock, test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { semearContaBase, semearGrupo, semearUsuario } from '@/test/semear-conta'
import { semearContaComAlvos, semearOs, semearVendaMoto, semearVendaPeca } from '@/test/semear-alvos-conciliacao'
import { ALVO_TIPOS, type AlvoTipo } from '@/lib/conciliacao-alvo'
import { sessaoDe, type Sessao } from '@/test/sessao'

const url = process.env.TEST_DATABASE_URL
if (!url || !['localhost', '127.0.0.1'].includes(new URL(url).hostname)) throw new Error('Use somente Postgres descartável local')
process.env.DATABASE_URL = url

let db: typeof import('@/lib/db')['db']
let actions: typeof import('@/app/(dashboard)/conciliacao/actions')
let contarPendenciasCartao: typeof import('@/lib/queries/conciliacao-pendentes')['contarPendenciasCartao']
let usuario: Sessao

const authMock = mock.module('@/lib/auth', { namedExports: { getUsuarioLogado: async () => usuario } })
const cacheMock = mock.module('next/cache', { namedExports: { revalidatePath: () => {} } })
const headersMock = mock.module('next/headers', { namedExports: { cookies: async () => ({ get: () => undefined }) } })

before(async () => {
  ;({ db } = await import('@/lib/db'))
  actions = await import('@/app/(dashboard)/conciliacao/actions')
  ;({ contarPendenciasCartao } = await import('@/lib/queries/conciliacao-pendentes'))
})
after(async () => {
  authMock.restore(); cacheMock.restore(); headersMock.restore()
  await (globalThis as { __pgPool?: { end(): Promise<void> } }).__pgPool?.end()
})

const OK = { ok: true, dados: undefined }
const CONCILIACAO_NAO_ENCONTRADA = { ok: false, erro: 'Conciliação não encontrada' }
const SEM_PERMISSAO = { ok: false, erro: 'Sem permissão' }
const NAO_ENCONTRADO: Record<AlvoTipo, { ok: false; erro: string }> = {
  moto: { ok: false, erro: 'Venda não encontrada' },
  peca: { ok: false, erro: 'Venda de peça não encontrada' },
  os:   { ok: false, erro: 'Ordem de serviço não encontrada' },
}
const COLUNA: Record<AlvoTipo, 'venda_id' | 'peca_venda_id' | 'os_id'> = { moto: 'venda_id', peca: 'peca_venda_id', os: 'os_id' }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const linhas = async (q: ReturnType<typeof sql>) => ((await db.execute(q)) as unknown as { rows: any[] }).rows

async function semear() {
  const suf = randomUUID()
  const base = await semearContaBase(db, { prefixo: 'CARTST', nome: suf, cnpj: suf })
  const usuarioId = await semearUsuario(db, base, { papel: 'aux_adm' })
  const [modelo] = await linhas(sql`insert into modelos (marca, modelo, categoria, potencia_w, motor, velocidade_max)
    values ('M', ${'CARTST ' + suf}, 'autopropelido', '1000', 'hub', '32') returning id`)
  const [moto] = await linhas(sql`insert into motos (chassi, modelo_id, loja_id, cor, nota_fiscal_entrada, status, disponibilidade)
    values (${randomUUID()}, ${modelo.id}, ${base.lojaId}, 'CINZA', '1', 'vendida', 'vendida') returning id`)
  const [pedido] = await linhas(sql`insert into pedidos_venda (moto_id, loja_id, vendedor_id) values (${moto.id}, ${base.lojaId}, ${usuarioId}) returning id`)
  const [venda] = await linhas(sql`insert into vendas (pedido_venda_id, moto_id, loja_id, vendedor_id, efetivado_por, cliente_nome, cliente_cpf, valor, forma_pagamento, pagamentos, data_venda)
    values (${pedido.id}, ${moto.id}, ${base.lojaId}, ${usuarioId}, ${usuarioId}, 'Cliente sintético', '52998224725', 1000, 'cartao_credito',
      '[{"tipo":"cartao_credito","valor":1000,"parcelas":1}]'::jsonb, '2026-11-05 12:00:00-03'::timestamptz) returning id`)
  usuario = sessaoDe(base, 'aux_adm', usuarioId)
  return { base, vendaId: venda.id as string }
}

async function cartao(grupoId: string, valor: number, status: string, vendaId: string | null) {
  const [c] = await linhas(sql`insert into conciliacoes_cartao (grupo_id, operadora, data_transacao, nsu, valor_bruto, status, venda_id, conciliado)
    values (${grupoId}, 'mercadopago', '2026-11-05', ${randomUUID()}, ${valor}, ${status}, ${vendaId}, false) returning id`)
  return c.id as string
}
const linhaDe = async (id: string) =>
  (await linhas(sql`select status, conciliado, venda_id, peca_venda_id, os_id from conciliacoes_cartao where id = ${id}`))[0]

test('cartão estornado não conta como pendência no dashboard; o aprovado sem vínculo conta', async () => {
  const { base, vendaId } = await semear()
  await cartao(base.grupoId, 1000, 'aprovado', null)
  await cartao(base.grupoId, 1000, 'estornado', vendaId)
  await cartao(base.grupoId, 500, 'estornado', null)
  assert.equal(await contarPendenciasCartao(base.grupoId), 1)
})

test('cartão estornado não é oferecido na busca livre nem na busca por valor', async () => {
  const { base, vendaId } = await semear()
  const aprovado = await cartao(base.grupoId, 4321.09, 'aprovado', null)
  const estornadoLigado = await cartao(base.grupoId, 4321.09, 'estornado', vendaId)
  const estornadoSolto = await cartao(base.grupoId, 4321.09, 'estornado', null)

  const livres = (await actions.buscarConciliacoesLivres('4321,09')).map(l => l.id)
  assert.ok(livres.includes(aprovado))
  assert.ok(!livres.includes(estornadoLigado))
  assert.ok(!livres.includes(estornadoSolto))

  const porValor = (await actions.buscarConciliacoesPorValor(4321.09)).map(l => l.id)
  assert.ok(porValor.includes(aprovado))
  assert.ok(!porValor.includes(estornadoSolto))
})

test('vincular cartão estornado é recusado com a frase de "não encontrada" e a linha não muda', async () => {
  const { base, vendaId } = await semear()
  const estornado = await cartao(base.grupoId, 1000, 'estornado', vendaId)
  const antes = await linhaDe(estornado)

  assert.deepEqual(await actions.vincularVendaAction(estornado, { tipo: 'moto', id: vendaId }), CONCILIACAO_NAO_ENCONTRADA)
  assert.deepEqual(await linhaDe(estornado), antes)
  assert.equal(antes.conciliado, false)

  // Mesma frase de um id que não existe: a recusa não revela que a linha existe.
  assert.deepEqual(await actions.vincularVendaAction(randomUUID(), { tipo: 'moto', id: vendaId }), CONCILIACAO_NAO_ENCONTRADA)

  // O aprovado continua vinculando.
  const aprovado = await cartao(base.grupoId, 1000, 'aprovado', null)
  assert.deepEqual(await actions.vincularVendaAction(aprovado, { tipo: 'moto', id: vendaId }), OK)
  const depois = await linhaDe(aprovado)
  assert.equal(depois.conciliado, true)
  assert.equal(depois.venda_id, vendaId)
})

// Isolamento (#891): o alvo do vínculo e a linha só valem na Conta de quem vincula.
test('vincular a venda, peça ou OS de outra Conta é recusado e a linha não muda', async () => {
  const b = await semear()
  const [pecaB] = await linhas(sql`insert into vendas_pecas (loja_id, vendedor_id, forma_pagamento, pagamentos, valor_total)
    values (${b.base.lojaId}, ${usuario.id}, 'cartao_credito', '[]'::jsonb, 100) returning id`)
  const [osB] = await linhas(sql`insert into ordens_servico (loja_id, aberta_por, descricao) values (${b.base.lojaId}, ${usuario.id}, 'revisão') returning id`)
  const { base } = await semear() // a sessão passa a ser a da Conta A
  const linhaA = await cartao(base.grupoId, 1000, 'aprovado', null)
  const antes = await linhaDe(linhaA)

  assert.deepEqual(await actions.vincularVendaAction(linhaA, { tipo: 'moto', id: b.vendaId }), NAO_ENCONTRADO.moto)
  assert.deepEqual(await actions.vincularVendaAction(linhaA, { tipo: 'peca', id: pecaB.id }), NAO_ENCONTRADO.peca)
  assert.deepEqual(await actions.vincularVendaAction(linhaA, { tipo: 'os', id: osB.id }), NAO_ENCONTRADO.os)
  assert.deepEqual(await linhaDe(linhaA), antes)
})

test('vincular a linha de outra Conta recebe "Conciliação não encontrada" e a linha não muda', async () => {
  const b = await semear()
  const linhaB = await cartao(b.base.grupoId, 1000, 'aprovado', null)
  const antes = await linhaDe(linhaB)
  const { vendaId } = await semear() // a sessão passa a ser a da Conta A

  assert.deepEqual(await actions.vincularVendaAction(linhaB, { tipo: 'moto', id: vendaId }), CONCILIACAO_NAO_ENCONTRADA)
  assert.deepEqual(await linhaDe(linhaB), antes)
})

// As somas de receita só olham conciliado = true: linha estornada conciliada contaria como paga.
test('o banco recusa linha estornada marcada como conciliada', async () => {
  const { base, vendaId } = await semear()
  await assert.rejects(
    linhas(sql`insert into conciliacoes_cartao (grupo_id, operadora, data_transacao, nsu, valor_bruto, status, venda_id, conciliado)
      values (${base.grupoId}, 'mercadopago', '2026-11-05', ${randomUUID()}, 1000, 'estornado', ${vendaId}, true)`),
    (e: unknown) => (e as { cause?: { code?: string } }).cause?.code === '23514',
  )
  const aprovada = await cartao(base.grupoId, 1000, 'aprovado', vendaId)
  await assert.rejects(
    linhas(sql`update conciliacoes_cartao set conciliado = true, status = 'estornado' where id = ${aprovada}`),
    (e: unknown) => (e as { cause?: { code?: string } }).cause?.code === '23514',
  )
})

// O estorno mantém o vínculo com a venda (decisão do Cesar, #51); desvincular não pode apagá-lo.
test('desvincular cartão estornado é recusado e o vínculo fica', async () => {
  const { base, vendaId } = await semear()
  const estornado = await cartao(base.grupoId, 1000, 'estornado', vendaId)
  const antes = await linhaDe(estornado)
  assert.deepEqual(await actions.desvincularVendaAction(estornado), CONCILIACAO_NAO_ENCONTRADA)
  assert.deepEqual(await linhaDe(estornado), antes)
  assert.equal(antes.venda_id, vendaId)
})

test('desvincular a linha de outra Conta recebe "Conciliação não encontrada" e a linha não muda', async () => {
  const b = await semear()
  const linhaB = await cartao(b.base.grupoId, 1000, 'aprovado', null)
  await linhas(sql`update conciliacoes_cartao set venda_id = ${b.vendaId}, conciliado = true where id = ${linhaB}`)
  const antes = await linhaDe(linhaB)
  await semear() // a sessão passa a ser a da Conta A

  assert.deepEqual(await actions.desvincularVendaAction(linhaB), CONCILIACAO_NAO_ENCONTRADA)
  assert.deepEqual(await linhaDe(linhaB), antes)
  assert.equal(antes.venda_id, b.vendaId)
})

test('busca livre e por valor não trazem linha de outra Conta com o mesmo valor', async () => {
  const b = await semear()
  const linhaB = await cartao(b.base.grupoId, 7654.32, 'aprovado', null)
  const a = await semear() // a sessão passa a ser a da Conta A
  const linhaA = await cartao(a.base.grupoId, 7654.32, 'aprovado', null)

  const livres = (await actions.buscarConciliacoesLivres('7654,32')).map(l => l.id)
  const porValor = (await actions.buscarConciliacoesPorValor(7654.32)).map(l => l.id)
  assert.ok(livres.includes(linhaA) && !livres.includes(linhaB))
  assert.ok(porValor.includes(linhaA) && !porValor.includes(linhaB))
})

// Vincular e desvincular pela conciliação de cartão (#129): recusa volta como valor, com a mesma
// frase para alvo de outra Conta, de outro grupo da mesma Conta e inexistente; alvo pela lista única.
const PAGAMENTOS = [{ tipo: 'cartao_credito', valor: 1000, parcelas: 1 }]

async function contaComLinha() {
  const a = await semearContaComAlvos(db, 'CART129', PAGAMENTOS)
  usuario = sessaoDe(a, 'aux_adm', a.balcao.usuarioId)
  return { a, linha: await cartao(a.grupoId, 1000, 'aprovado', null) }
}

const LIVRE = { status: 'aprovado', conciliado: false, venda_id: null, peca_venda_id: null, os_id: null }

test('guarda: vincular venda de moto, peça e OS da própria Conta grava só a coluna do tipo e concilia', async () => {
  for (const tipo of ALVO_TIPOS) {
    const { a, linha } = await contaComLinha()
    assert.deepEqual(await actions.vincularVendaAction(linha, { tipo, id: a.alvos[tipo] }), OK, tipo)
    assert.deepEqual(await linhaDe(linha), { ...LIVRE, conciliado: true, [COLUNA[tipo]]: a.alvos[tipo] }, tipo)
  }
})

test('vincular alvo de outra Conta, de outro grupo da mesma Conta ou inexistente: a mesma frase por tipo e a linha não muda', async () => {
  const b = await semearContaComAlvos(db, 'CART129', PAGAMENTOS)
  const { a, linha } = await contaComLinha()
  const g2 = await semearGrupo(db, a.contaId, { prefixo: 'CART129', nome: randomUUID(), cnpj: randomUUID() })
  const balcao2 = { ...a.balcao, lojaId: g2.lojaId }
  const doOutroGrupo: Record<AlvoTipo, string> = {
    moto: await semearVendaMoto(db, balcao2, PAGAMENTOS),
    peca: await semearVendaPeca(db, balcao2, PAGAMENTOS),
    os:   await semearOs(db, balcao2, PAGAMENTOS),
  }
  for (const tipo of ALVO_TIPOS) {
    for (const [rotulo, id] of [['outra Conta', b.alvos[tipo]], ['outro grupo', doOutroGrupo[tipo]], ['inexistente', randomUUID()]] as const) {
      assert.deepEqual(await actions.vincularVendaAction(linha, { tipo, id }), NAO_ENCONTRADO[tipo], `${tipo}, ${rotulo}`)
    }
  }
  assert.deepEqual(await linhaDe(linha), LIVRE)
})

test('vincular com tipo fora da lista ou id que não é uuid: "Venda não encontrada" e nada é gravado', async () => {
  const { a, linha } = await contaComLinha()
  const forjados = [{ tipo: 'xyz', id: a.alvos.moto }, { tipo: 'moto', id: 'abc' }, null] as unknown as { tipo: AlvoTipo; id: string }[]
  for (const alvo of forjados) {
    assert.deepEqual(await actions.vincularVendaAction(linha, alvo), NAO_ENCONTRADO.moto, JSON.stringify(alvo))
  }
  assert.deepEqual(await linhaDe(linha), LIVRE)
})

test('vincular e desvincular com id da conciliação que não é uuid: "Conciliação não encontrada"', async () => {
  const { a } = await contaComLinha()
  assert.deepEqual(await actions.vincularVendaAction('abc', { tipo: 'moto', id: a.alvos.moto }), CONCILIACAO_NAO_ENCONTRADA)
  assert.deepEqual(await actions.desvincularVendaAction('abc'), CONCILIACAO_NAO_ENCONTRADA)
})

test('desvincular linha inexistente recebe a mesma frase da linha de outra Conta; o próprio vínculo se desfaz nos 3 tipos', async () => {
  assert.deepEqual(await actions.desvincularVendaAction(randomUUID()), CONCILIACAO_NAO_ENCONTRADA)
  for (const tipo of ALVO_TIPOS) {
    const { a, linha } = await contaComLinha()
    assert.deepEqual(await actions.vincularVendaAction(linha, { tipo, id: a.alvos[tipo] }), OK, tipo)
    assert.deepEqual(await actions.desvincularVendaAction(linha), OK, tipo)
    assert.deepEqual(await linhaDe(linha), LIVRE, tipo)
  }
})

test('vendedor e mecânico não vinculam nem desvinculam: "Sem permissão" e nada muda', async () => {
  const { a, linha } = await contaComLinha()
  const ligada = await cartao(a.grupoId, 1000, 'aprovado', null)
  assert.deepEqual(await actions.vincularVendaAction(ligada, { tipo: 'moto', id: a.alvos.moto }), OK)
  const antes = await linhaDe(ligada)
  for (const papel of ['vendedor', 'mecanico']) {
    usuario = { ...usuario, papel }
    assert.deepEqual(await actions.vincularVendaAction(linha, { tipo: 'moto', id: a.alvos.moto }), SEM_PERMISSAO, papel)
    assert.deepEqual(await actions.desvincularVendaAction(ligada), SEM_PERMISSAO, papel)
  }
  assert.deepEqual(await linhaDe(linha), LIVRE)
  assert.deepEqual(await linhaDe(ligada), antes)
})
