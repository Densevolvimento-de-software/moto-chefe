// Teste de banco: a busca de vendas para vincular a uma linha da conciliação de cartão procura o tipo
// de pagamento que a linha cobre (linha pix do Mercado Pago, #51 -> pagamento Pix) e só na Conta.
// Roda a action de verdade contra o Postgres descartável; só a sessão e o cache do Next são simulados.
import { after, before, mock, test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { semearContaBase, semearUsuario } from '@/test/semear-conta'

const url = process.env.TEST_DATABASE_URL
if (!url || !['localhost', '127.0.0.1'].includes(new URL(url).hostname)) throw new Error('Use somente Postgres descartável local')
process.env.DATABASE_URL = url

type Sessao = { id: string; papel: string; lojaId: string | null; contaId: string | null; gruposAcesso: string[]; gruposAprovacao: string[] }
let db: typeof import('@/lib/db')['db']
let actions: typeof import('@/app/(dashboard)/conciliacao/actions')
let usuario: Sessao

const authMock = mock.module('@/lib/auth', { namedExports: { getUsuarioLogado: async () => usuario } })
const cacheMock = mock.module('next/cache', { namedExports: { revalidatePath: () => {} } })
const headersMock = mock.module('next/headers', { namedExports: { cookies: async () => ({ get: () => undefined }) } })

before(async () => {
  ;({ db } = await import('@/lib/db'))
  actions = await import('@/app/(dashboard)/conciliacao/actions')
})
after(async () => {
  authMock.restore(); cacheMock.restore(); headersMock.restore()
  await (globalThis as { __pgPool?: { end(): Promise<void> } }).__pgPool?.end()
})

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const linhas = async (q: ReturnType<typeof sql>) => ((await db.execute(q)) as unknown as { rows: any[] }).rows

async function semearConta() {
  const suf = randomUUID()
  const base = await semearContaBase(db, { prefixo: 'VINCBUSCA', nome: suf, cnpj: suf })
  const usuarioId = await semearUsuario(db, base, { papel: 'aux_adm' })
  return { ...base, usuarioId }
}
type Conta = Awaited<ReturnType<typeof semearConta>>

const entrarComo = (c: Conta) => {
  usuario = { id: c.usuarioId, papel: 'aux_adm', lojaId: c.lojaId, contaId: c.contaId, gruposAcesso: [], gruposAprovacao: [] }
}

async function vendaPeca(c: Conta, pagamentos: Record<string, unknown>[]) {
  const [v] = await linhas(sql`insert into vendas_pecas (loja_id, vendedor_id, forma_pagamento, pagamentos, valor_total, data_venda)
    values (${c.lojaId}, ${c.usuarioId}, 'pix', ${JSON.stringify(pagamentos)}::jsonb, 100, '2026-11-05 12:00:00-03'::timestamptz) returning id`)
  return v.id as string
}

async function linha(c: Conta, tipo: string, valor: number) {
  const [l] = await linhas(sql`insert into conciliacoes_cartao (grupo_id, operadora, data_transacao, nsu, valor_bruto, tipo)
    values (${c.grupoId}, 'mercadopago', '2026-11-05', ${randomUUID()}, ${valor}, ${tipo}) returning id`)
  return l.id as string
}

// Valores únicos por teste: a busca olha as vendas da Conta, e cada teste cria a sua.
test('linha pix acha a venda paga em Pix e não a paga no cartão do mesmo valor', async () => {
  const a = await semearConta()
  const pix = await vendaPeca(a, [{ tipo: 'pix', valor: 212.34 }])
  await vendaPeca(a, [{ tipo: 'cartao_credito', valor: 212.34, parcelas: 1 }])
  entrarComo(a)
  const achadas = await actions.buscarVendasParaVincular(await linha(a, 'pix', 212.34))
  assert.deepEqual(achadas.map(v => v.id), [pix])
})

test('linha de cartão acha a venda paga no cartão e não a paga em Pix', async () => {
  const a = await semearConta()
  await vendaPeca(a, [{ tipo: 'pix', valor: 313.45 }])
  const cartao = await vendaPeca(a, [{ tipo: 'cartao_debito', valor: 313.45, parcelas: 1 }])
  entrarComo(a)
  const achadas = await actions.buscarVendasParaVincular(await linha(a, 'debito', 313.45))
  assert.deepEqual(achadas.map(v => v.id), [cartao])
})

test('linha de outra Conta não busca nada, como linha inexistente', async () => {
  const a = await semearConta()
  const b = await semearConta()
  await vendaPeca(a, [{ tipo: 'pix', valor: 414.56 }])
  const daOutraConta = await linha(b, 'pix', 414.56)
  entrarComo(a)
  assert.deepEqual(await actions.buscarVendasParaVincular(daOutraConta), [])
  assert.deepEqual(await actions.buscarVendasParaVincular(randomUUID()), [])
})

test('papel sem a conciliação (vendedor) é recusado e não vê vendas', async () => {
  const a = await semearConta()
  await vendaPeca(a, [{ tipo: 'pix', valor: 515.67 }])
  const linhaA = await linha(a, 'pix', 515.67)
  usuario = { id: a.usuarioId, papel: 'vendedor', lojaId: a.lojaId, contaId: a.contaId, gruposAcesso: [], gruposAprovacao: [] }
  await assert.rejects(actions.buscarVendasParaVincular(linhaA), { message: 'Sem permissão' })
})

// O painel da venda usa estas duas buscas para o pagamento de cartão: a linha pix do Mercado Pago não
// pode aparecer ali (vinculada a um cartão, o detalhe ficaria vermelho e a lista diria conciliada).
test('buscas do painel para pagamento de cartão não oferecem a linha pix', async () => {
  const a = await semearConta()
  const cartao = await linha(a, 'credito', 616.78)
  const pix = await linha(a, 'pix', 616.78)
  entrarComo(a)
  const porValor = (await actions.buscarConciliacoesPorValor(616.78)).map(l => l.id)
  const livres = (await actions.buscarConciliacoesLivres('616,78')).map(l => l.id)
  assert.ok(porValor.includes(cartao) && !porValor.includes(pix))
  assert.ok(livres.includes(cartao) && !livres.includes(pix))
})

// O vincular recusa linha estornada (cartaoNaoEstornado): a busca não oferece candidatos para ela.
test('linha estornada não busca vendas para vincular', async () => {
  const a = await semearConta()
  const venda = await vendaPeca(a, [{ tipo: 'cartao_credito', valor: 717.89, parcelas: 1 }])
  const estornada = await linha(a, 'credito', 717.89)
  entrarComo(a)
  // Controle: aprovada, a mesma linha traz a venda.
  assert.deepEqual((await actions.buscarVendasParaVincular(estornada)).map(v => v.id), [venda])
  await linhas(sql`update conciliacoes_cartao set status = 'estornado' where id = ${estornada}`)
  assert.deepEqual(await actions.buscarVendasParaVincular(estornada), [])
})
