// Teste de banco: Postgres descartável. Moto "Em transporte" (#12, P8 e P9 da mãe #7) é estoque como a
// caixa: entra no Showroom e no Total, no estoque do Dashboard e no estoque de Compras. A Conta B não
// vê nem soma as motos da Conta A, nem pedindo a loja da A no filtro do Showroom.
// As consultas usam o db global (sem transação): os dados são gravados de verdade e apagados no after.
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { sql } from 'drizzle-orm'
import { semearContaBase } from '@/test/semear-conta'

const url = process.env.TEST_DATABASE_URL
if (!url) throw new Error('TEST_DATABASE_URL não definida — este teste só roda num Postgres descartável')
if (!['localhost', '127.0.0.1'].includes(new URL(url).hostname)) {
  throw new Error('TEST_DATABASE_URL precisa ser loopback (Postgres descartável)')
}
process.env.DATABASE_URL = url

const P = 'ETS12'

type Db = typeof import('@/lib/db')
let db: Db['db']
const semente = { contaA: '', grupoA: '', lojaA: '', contaB: '', grupoB: '', lojaB: '' }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const linhas = async (q: ReturnType<typeof sql>) => ((await db.execute(q)) as unknown as { rows: any[] }).rows

before(async () => {
  ;({ db } = await import('@/lib/db'))
  const a = await semearContaBase(db, { prefixo: P, nome: 'A', cnpj: '00000000001201' })
  const b = await semearContaBase(db, { prefixo: P, nome: 'B', cnpj: '00000000001202' })
  Object.assign(semente, { contaA: a.contaId, grupoA: a.grupoId, lojaA: a.lojaId, contaB: b.contaId, grupoB: b.grupoId, lojaB: b.lojaId })
  const [modelo] = await linhas(sql`insert into modelos (marca, modelo, categoria, potencia_w, motor, velocidade_max) values ('M', ${P}, 'autopropelido', '1000', 'hub', '32') returning id`)
  // Preços diferentes dizem quais motos entraram na soma do valor do estoque.
  const motos = [
    ['ET1', a.lojaId, 'em_transporte', null, 100],
    ['ET2', a.lojaId, 'em_transporte', 'reservada', 200],
    ['CX', a.lojaId, 'caixa', null, 400],
    ['MT', a.lojaId, 'montada', 'disponivel', 800],
    ['ETB', b.lojaId, 'em_transporte', null, 1600],
  ] as const
  for (const [rotulo, loja, status, disponibilidade, preco] of motos) {
    await db.execute(sql`insert into motos (chassi, modelo_id, loja_id, cor, nota_fiscal_entrada, status, disponibilidade, preco_compra)
      values (${P + rotulo}, ${modelo.id}, ${loja}, 'CINZA', '1', ${status}, ${disponibilidade}, ${preco})`)
  }
})

after(async () => {
  await db.execute(sql`delete from motos where chassi like ${P + '%'}`)
  await db.execute(sql`delete from modelos where modelo = ${P}`)
  for (const grupo of [semente.grupoA, semente.grupoB]) {
    await db.execute(sql`delete from lojas where grupo_id = ${grupo}`)
    await db.execute(sql`delete from grupos where id = ${grupo}`)
  }
  for (const conta of [semente.contaA, semente.contaB]) await db.execute(sql`delete from contas where id = ${conta}`)
  await (globalThis as { __pgPool?: { end(): Promise<void> } }).__pgPool?.end()
})

const socio = { papel: 'admin_socio', lojaId: null }
const chassis = (motos: { chassi: string }[]) => motos.map(m => m.chassi.slice(P.length)).sort()

/** O Showroom como a página monta: filtros da URL contra as lojas do grupo, e os cards contados da lista. */
async function showroom(params: Record<string, string>, lojasDoGrupo: string[]) {
  const { listarMotos } = await import('@/lib/queries/motos')
  const { filtrosDoShowroom } = await import('@/lib/showroom-filtros')
  const { contarCardsDoShowroom } = await import('@/lib/showroom-contagem')
  const motos = await listarMotos(filtrosDoShowroom(params, socio, lojasDoGrupo))
  return { motos: chassis(motos), cards: contarCardsDoShowroom(motos) }
}

test('Showroom: a moto em transporte entra na lista e no Total, com o próprio card; o filtro Em transporte traz só elas', async () => {
  const tudo = await showroom({}, [semente.lojaA])
  assert.deepEqual(tudo.motos, ['CX', 'ET1', 'ET2', 'MT'])
  assert.equal(tudo.cards.total, 4)
  assert.equal(tudo.cards.em_transporte, 2)

  const soEmTransporte = await showroom({ status: 'em_transporte' }, [semente.lojaA])
  assert.deepEqual(soEmTransporte.motos, ['ET1', 'ET2'])

  // Recorte sem moto em transporte: o card conta 0 e some da tela (status-cards.test.tsx).
  assert.equal((await showroom({ status: 'caixa' }, [semente.lojaA])).cards.em_transporte, 0)
})

test('Dashboard: a moto em transporte conta no estoque e no valor do estoque, como a caixa', async () => {
  const { getKPIs, getEstoquePorLoja } = await import('@/lib/queries/dashboard')
  const kpis = await getKPIs({ dataInicio: '2026-11-01', dataFim: '2026-11-30', lojaId: [semente.lojaA] })
  assert.equal(kpis.estoque, 4)
  assert.equal(kpis.valorEstoque, 1500)
  assert.deepEqual(await getEstoquePorLoja([semente.lojaA]), [{ loja: `Loja ${P} A`, total: 4 }])
})

test('Compras: a moto em transporte conta no estoque do modelo, como a caixa (não sugere comprar de novo)', async () => {
  const { listarDadosCompras } = await import('@/lib/queries/compras')
  const grupos = await listarDadosCompras(semente.lojaA, [semente.lojaA])
  assert.deepEqual(grupos.map(g => [g.modelo, g.totalEstoque]), [[P, 4]])
})

test('Conta B: não vê nem soma as motos da Conta A no Showroom, no Dashboard e em Compras, nem pedindo a loja da A', async () => {
  const { getKPIs, getEstoquePorLoja } = await import('@/lib/queries/dashboard')
  const { listarDadosCompras } = await import('@/lib/queries/compras')
  const lojasDaB = [semente.lojaB]

  const tela = await showroom({ loja: semente.lojaA }, lojasDaB)
  assert.deepEqual(tela.motos, ['ETB'])
  assert.equal(tela.cards.em_transporte, 1)

  const kpis = await getKPIs({ dataInicio: '2026-11-01', dataFim: '2026-11-30', lojaId: lojasDaB })
  assert.equal(kpis.estoque, 1)
  assert.equal(kpis.valorEstoque, 1600)
  assert.deepEqual(await getEstoquePorLoja(lojasDaB), [{ loja: `Loja ${P} B`, total: 1 }])
  assert.deepEqual((await listarDadosCompras(undefined, lojasDaB)).map(g => g.totalEstoque), [1])
})
