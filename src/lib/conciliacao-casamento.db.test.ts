// Teste de banco: casamento de transação de cartão com a venda (moto, peça, OS), contra o Postgres
// descartável do CI. Cada cenário roda numa transação desfeita e só vê as lojas que ele mesmo criou.
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { semearContaBase, semearUsuario } from '@/test/semear-conta'

const url = process.env.TEST_DATABASE_URL
if (!url || !['localhost', '127.0.0.1'].includes(new URL(url).hostname)) throw new Error('Use somente Postgres descartável local')
process.env.DATABASE_URL = url

type Db = typeof import('@/lib/db')
type Tx = Parameters<Parameters<Db['db']['transaction']>[0]>[0]
let db: Db['db']
let mod: typeof import('./conciliacao-casamento')

before(async () => {
  ;({ db } = await import('@/lib/db'))
  mod = await import('./conciliacao-casamento')
})
after(async () => {
  await (globalThis as { __pgPool?: { end(): Promise<void> } }).__pgPool?.end()
})

class Desfazer extends Error {}
async function emTransacaoDesfeita(fn: (tx: Tx) => Promise<void>) {
  await assert.rejects(db.transaction(async tx => { await fn(tx); throw new Desfazer() }), Desfazer)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const linhas = async (tx: Tx, q: ReturnType<typeof sql>) => ((await tx.execute(q)) as unknown as { rows: any[] }).rows

async function semearConta(tx: Tx, nome: string) {
  const suf = randomUUID()
  const base = await semearContaBase(tx, { prefixo: 'CM2MP', nome: `${nome} ${suf}`, cnpj: suf })
  const usuarioId = await semearUsuario(tx, base, { papel: 'aux_adm' })
  const [modelo] = await linhas(tx, sql`insert into modelos (marca, modelo, categoria, potencia_w, motor, velocidade_max)
    values ('M', ${'CM2MP ' + suf}, 'autopropelido', '1000', 'hub', '32') returning id`)
  return { ...base, usuarioId, modeloId: modelo.id as string }
}
type Conta = Awaited<ReturnType<typeof semearConta>>

const DIA = '2026-11-05'
const noDia = `${DIA} 12:00:00-03`

type Pagamentos = Record<string, unknown>[]
const cartao = (valor: number, parcelas: number, extra: Record<string, unknown> = {}): Pagamentos =>
  [{ tipo: 'cartao_credito', valor, parcelas, ...extra }]

async function semearVendaMoto(tx: Tx, c: Conta, pagamentos: Pagamentos) {
  const [moto] = await linhas(tx, sql`insert into motos (chassi, modelo_id, loja_id, cor, nota_fiscal_entrada, status, disponibilidade)
    values (${randomUUID()}, ${c.modeloId}, ${c.lojaId}, 'CINZA', '1', 'vendida', 'vendida') returning id`)
  const [pedido] = await linhas(tx, sql`insert into pedidos_venda (moto_id, loja_id, vendedor_id) values (${moto.id}, ${c.lojaId}, ${c.usuarioId}) returning id`)
  const [venda] = await linhas(tx, sql`insert into vendas (pedido_venda_id, moto_id, loja_id, vendedor_id, efetivado_por, cliente_nome, cliente_cpf, valor, forma_pagamento, pagamentos, data_venda)
    values (${pedido.id}, ${moto.id}, ${c.lojaId}, ${c.usuarioId}, ${c.usuarioId}, 'Cliente sintético', '52998224725', 1000, 'cartao_credito',
      ${JSON.stringify(pagamentos)}::jsonb, ${noDia}::timestamptz) returning id`)
  return venda.id as string
}

async function semearVendaPeca(tx: Tx, c: Conta, pagamentos: Pagamentos) {
  const [venda] = await linhas(tx, sql`insert into vendas_pecas (loja_id, vendedor_id, forma_pagamento, pagamentos, valor_total, data_venda)
    values (${c.lojaId}, ${c.usuarioId}, 'cartao_credito', ${JSON.stringify(pagamentos)}::jsonb, 100, ${noDia}::timestamptz) returning id`)
  return venda.id as string
}

async function semearOs(tx: Tx, c: Conta, pagamentos: Pagamentos, concluidaEm = noDia) {
  const [os] = await linhas(tx, sql`insert into ordens_servico (loja_id, aberta_por, descricao, status, pagamentos, data_conclusao)
    values (${c.lojaId}, ${c.usuarioId}, 'revisão', 'concluida', ${JSON.stringify(pagamentos)}::jsonb, ${concluidaEm}::timestamptz) returning id`)
  return os.id as string
}

const NENHUM = { vendaId: null, pecaVendaId: null, osId: null }
const transacao = (valorBruto: number, parcelas: number) => ({ dataTransacao: DIA, valorBruto, parcelas })

test('casarPorValor acha a venda do grupo A', async () => {
  await emTransacaoDesfeita(async tx => {
    const a = await semearConta(tx, 'A')
    const vendaId = await semearVendaMoto(tx, a, cartao(1234.56, 3))
    assert.deepEqual(await mod.casarPorValor(tx, [a.lojaId], transacao(1234.56, 3)), { ...NENHUM, vendaId })
  })
})

test('casarPorValor não casa venda de outra Conta', async () => {
  await emTransacaoDesfeita(async tx => {
    const a = await semearConta(tx, 'A')
    const b = await semearConta(tx, 'B')
    await semearVendaMoto(tx, b, cartao(1234.56, 3))
    assert.deepEqual(await mod.casarPorValor(tx, [a.lojaId], transacao(1234.56, 3)), NENHUM)
  })
})

test('casarPorValor respeita parcelas e tolerância', async () => {
  await emTransacaoDesfeita(async tx => {
    const a = await semearConta(tx, 'A')
    const vendaId = await semearVendaMoto(tx, a, cartao(1234.56, 3))
    assert.deepEqual(await mod.casarPorValor(tx, [a.lojaId], transacao(1234.62, 3)), NENHUM)
    assert.deepEqual(await mod.casarPorValor(tx, [a.lojaId], transacao(1234.6, 3)), { ...NENHUM, vendaId })
    assert.deepEqual(await mod.casarPorValor(tx, [a.lojaId], transacao(1234.56, 2)), NENHUM)
  })
})

test('casarPorValor cai para a peça quando a moto não casa, e sem lojas não casa nada', async () => {
  await emTransacaoDesfeita(async tx => {
    const a = await semearConta(tx, 'A')
    const pecaVendaId = await semearVendaPeca(tx, a, cartao(88.8, 1))
    assert.deepEqual(await mod.casarPorValor(tx, [a.lojaId], transacao(88.8, 1)), { ...NENHUM, pecaVendaId })
    assert.deepEqual(await mod.casarPorValor(tx, [], transacao(88.8, 1)), NENHUM)
  })
})

test('casarPorAutorizacao acha peça quando não há moto', async () => {
  await emTransacaoDesfeita(async tx => {
    const a = await semearConta(tx, 'A')
    const pecaVendaId = await semearVendaPeca(tx, a, cartao(50, 1, { autorizacao: 'ABC123' }))
    assert.deepEqual(await mod.casarPorAutorizacao(tx, [a.lojaId], 'ABC123'), { ...NENHUM, pecaVendaId })
    assert.deepEqual(await mod.casarPorAutorizacao(tx, [a.lojaId], 'ZZZ999'), NENHUM)
  })
})

test('casarPorAutorizacao prefere a moto e não cruza Contas', async () => {
  await emTransacaoDesfeita(async tx => {
    const a = await semearConta(tx, 'A')
    const b = await semearConta(tx, 'B')
    const vendaId = await semearVendaMoto(tx, a, cartao(50, 1, { autorizacao: 'DEF456' }))
    await semearVendaPeca(tx, a, cartao(50, 1, { autorizacao: 'DEF456' }))
    assert.deepEqual(await mod.casarPorAutorizacao(tx, [a.lojaId], 'DEF456'), { ...NENHUM, vendaId })
    assert.deepEqual(await mod.casarPorAutorizacao(tx, [b.lojaId], 'DEF456'), NENHUM)
    assert.deepEqual(await mod.casarPorAutorizacao(tx, [], 'DEF456'), NENHUM)
  })
})

test('casarPorValor cai para a OS quando moto e peça não casam', async () => {
  await emTransacaoDesfeita(async tx => {
    const a = await semearConta(tx, 'A')
    await semearVendaPeca(tx, a, cartao(70, 1))
    const osId = await semearOs(tx, a, cartao(321.5, 2))
    assert.deepEqual(await mod.casarPorValor(tx, [a.lojaId], transacao(321.5, 2)), { ...NENHUM, osId })
  })
})

test('casarPorValor prefere a moto quando moto e peça casam', async () => {
  await emTransacaoDesfeita(async tx => {
    const a = await semearConta(tx, 'A')
    await semearVendaPeca(tx, a, cartao(500, 1))
    const vendaId = await semearVendaMoto(tx, a, cartao(500, 1))
    assert.deepEqual(await mod.casarPorValor(tx, [a.lojaId], transacao(500, 1)), { ...NENHUM, vendaId })
  })
})

test('casarPorValor aceita débito e link de pagamento, e não casa Pix do mesmo valor', async () => {
  await emTransacaoDesfeita(async tx => {
    const a = await semearConta(tx, 'A')
    const debito = await semearVendaPeca(tx, a, [{ tipo: 'cartao_debito', valor: 41, parcelas: 1 }])
    const link = await semearVendaPeca(tx, a, [{ tipo: 'link_pagamento', valor: 42, parcelas: 1 }])
    await semearVendaPeca(tx, a, [{ tipo: 'pix', valor: 43 }])
    assert.deepEqual(await mod.casarPorValor(tx, [a.lojaId], transacao(41, 1)), { ...NENHUM, pecaVendaId: debito })
    assert.deepEqual(await mod.casarPorValor(tx, [a.lojaId], transacao(42, 1)), { ...NENHUM, pecaVendaId: link })
    assert.deepEqual(await mod.casarPorValor(tx, [a.lojaId], transacao(43, 1)), NENHUM)
  })
})

// A janela é de 24 h para cada lado do meio-dia UTC do dia da transação. A venda às 12h de Brasília
// (15h UTC) casa com a transação do dia seguinte e não com a do dia anterior (que vai só até 12h UTC).
test('casarPorValor: janela de 24 h em volta do meio-dia UTC do dia da transação', async () => {
  await emTransacaoDesfeita(async tx => {
    const a = await semearConta(tx, 'A')
    const vendaId = await semearVendaMoto(tx, a, cartao(777, 1))
    const em = (dataTransacao: string) => mod.casarPorValor(tx, [a.lojaId], { dataTransacao, valorBruto: 777, parcelas: 1 })
    assert.deepEqual(await em('2026-11-05'), { ...NENHUM, vendaId })
    assert.deepEqual(await em('2026-11-06'), { ...NENHUM, vendaId })
    assert.deepEqual(await em('2026-11-04'), NENHUM)
    assert.deepEqual(await em('2026-11-07'), NENHUM)
  })
})

test('casarPorValor: pagamento sem parcelas registradas casa com qualquer número de parcelas', async () => {
  await emTransacaoDesfeita(async tx => {
    const a = await semearConta(tx, 'A')
    const vendaId = await semearVendaMoto(tx, a, [{ tipo: 'cartao_credito', valor: 999 }])
    assert.deepEqual(await mod.casarPorValor(tx, [a.lojaId], transacao(999, 10)), { ...NENHUM, vendaId })
  })
})

test('casarPorAutorizacao acha a OS e não cruza Contas', async () => {
  await emTransacaoDesfeita(async tx => {
    const a = await semearConta(tx, 'A')
    const b = await semearConta(tx, 'B')
    const osId = await semearOs(tx, a, cartao(60, 1, { autorizacao: 'OS7788' }))
    assert.deepEqual(await mod.casarPorAutorizacao(tx, [a.lojaId], 'OS7788'), { ...NENHUM, osId })
    assert.deepEqual(await mod.casarPorAutorizacao(tx, [b.lojaId], 'OS7788'), NENHUM)
  })
})
