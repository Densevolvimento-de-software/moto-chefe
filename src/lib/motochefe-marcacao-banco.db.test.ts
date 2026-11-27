// Teste de banco: Postgres descartável. Tela Lojas MotoChefe (#321): marcar loja e autorizar Conta gravam
// só o próprio campo, em A×B; o log sai na mesma transação; a listagem traz as Contas ativas.
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { semearContaBase, semearContaVazia, semearGrupo, semearLoja } from '@/test/semear-conta'

const url = process.env.TEST_DATABASE_URL
if (!url) throw new Error('TEST_DATABASE_URL não definida — este teste só roda num Postgres descartável')
if (!['localhost', '127.0.0.1'].includes(new URL(url).hostname)) {
  throw new Error('TEST_DATABASE_URL precisa ser loopback (Postgres descartável)')
}
process.env.DATABASE_URL = url

type Db = typeof import('@/lib/db')
type Tx = Parameters<Parameters<Db['db']['transaction']>[0]>[0]
let db: Db['db']
let mod: typeof import('@/lib/motochefe-marcacao-banco')

before(async () => {
  ;({ db } = await import('@/lib/db'))
  mod = await import('@/lib/motochefe-marcacao-banco')
})
after(async () => { await (globalThis as { __pgPool?: { end(): Promise<void> } }).__pgPool?.end() })

class Desfazer extends Error {}
// Tudo que o teste grava se desfaz no fim: nada fica no banco compartilhado do test:db.
async function emTransacaoDesfeita(corpo: (tx: Tx) => Promise<void>) {
  try {
    await db.transaction(async tx => { await corpo(tx); throw new Desfazer() })
  } catch (e) {
    if (!(e instanceof Desfazer)) throw e
  }
}

// Lê pela mesma transação: só ela enxerga o que o teste gravou.
const linhas = async <T>(tx: Tx, q: ReturnType<typeof sql>): Promise<T[]> =>
  ((await tx.execute(q)) as unknown as { rows: T[] }).rows

const P = 'MCB1'
const cnpj = () => String(Math.floor(Math.random() * 1e14)).padStart(14, '0')

async function semear(tx: Tx) {
  const a = await semearContaBase(tx, { prefixo: P, nome: 'A', cnpj: cnpj() })
  const lojaA2 = await semearLoja(tx, a.grupoId, `Loja ${P} A2`)
  const b = await semearContaBase(tx, { prefixo: P, nome: 'B', cnpj: cnpj() })
  return { a, b, lojaA2 }
}

const marcadaDaLoja = async (tx: Tx, id: string) =>
  (await linhas<{ marcada: boolean }>(tx, sql`select loja_motochefe as marcada from lojas where id = ${id}`))[0].marcada
const autorizadaDaConta = async (tx: Tx, id: string) =>
  (await linhas<{ autorizada: boolean }>(tx, sql`select autoriza_custo_despesa_meta as autorizada from contas where id = ${id}`))[0].autorizada

test('marcar loja grava só nela: a outra loja da mesma Conta e a loja da Conta B não mudam', async () => {
  await emTransacaoDesfeita(async tx => {
    const { a, b, lojaA2 } = await semear(tx)
    assert.deepEqual(await mod.marcarLojaMotochefe(randomUUID(), { lojaId: a.lojaId, marcada: true }, tx), { ok: true })
    assert.equal(await marcadaDaLoja(tx, a.lojaId), true)
    assert.equal(await marcadaDaLoja(tx, lojaA2), false)
    assert.equal(await marcadaDaLoja(tx, b.lojaId), false)
  })
})

test('desmarcar volta a false', async () => {
  await emTransacaoDesfeita(async tx => {
    const { a } = await semear(tx)
    const admin = randomUUID()
    await mod.marcarLojaMotochefe(admin, { lojaId: a.lojaId, marcada: true }, tx)
    await mod.marcarLojaMotochefe(admin, { lojaId: a.lojaId, marcada: false }, tx)
    assert.equal(await marcadaDaLoja(tx, a.lojaId), false)
  })
})

test('loja inexistente recebe "Loja não encontrada", e nenhuma linha vai para o log', async () => {
  await emTransacaoDesfeita(async tx => {
    const admin = randomUUID()
    assert.deepEqual(
      await mod.marcarLojaMotochefe(admin, { lojaId: randomUUID(), marcada: true }, tx),
      { ok: false, erro: 'Loja não encontrada' },
    )
    assert.equal((await linhas(tx, sql`select 1 from log_acoes where usuario_id = ${admin}`)).length, 0)
  })
})

test('marcar de novo o que já está marcado: nenhuma linha nova no log', async () => {
  await emTransacaoDesfeita(async tx => {
    const { a } = await semear(tx)
    const admin = randomUUID()
    await mod.marcarLojaMotochefe(admin, { lojaId: a.lojaId, marcada: true }, tx)
    assert.deepEqual(await mod.marcarLojaMotochefe(admin, { lojaId: a.lojaId, marcada: true }, tx), { ok: true })
    assert.equal((await linhas(tx, sql`select 1 from log_acoes where usuario_id = ${admin}`)).length, 1)
  })
})

test('autorizar Conta grava só nela; desautorizar volta a false', async () => {
  await emTransacaoDesfeita(async tx => {
    const { a, b } = await semear(tx)
    const admin = randomUUID()
    assert.deepEqual(await mod.autorizarCustoDespesaMeta(admin, { contaId: a.contaId, autorizada: true }, tx), { ok: true })
    assert.equal(await autorizadaDaConta(tx, a.contaId), true)
    assert.equal(await autorizadaDaConta(tx, b.contaId), false)
    await mod.autorizarCustoDespesaMeta(admin, { contaId: a.contaId, autorizada: false }, tx)
    assert.equal(await autorizadaDaConta(tx, a.contaId), false)
  })
})

test('Conta inexistente recebe "Conta não encontrada", e nada é gravado', async () => {
  await emTransacaoDesfeita(async tx => {
    assert.deepEqual(
      await mod.autorizarCustoDespesaMeta(randomUUID(), { contaId: randomUUID(), autorizada: true }, tx),
      { ok: false, erro: 'Conta não encontrada' },
    )
  })
})

// Quatro passos: a loja grava o grupo dela; a Conta grava só a Conta (grupo nulo), como alterarTransferenciaEntreGrupos.
test('o log grava tipo, quem fez, grupo e Conta de cada ação', async () => {
  await emTransacaoDesfeita(async tx => {
    const { a } = await semear(tx)
    const admin = randomUUID()
    await mod.marcarLojaMotochefe(admin, { lojaId: a.lojaId, marcada: true }, tx)
    await mod.marcarLojaMotochefe(admin, { lojaId: a.lojaId, marcada: false }, tx)
    await mod.autorizarCustoDespesaMeta(admin, { contaId: a.contaId, autorizada: true }, tx)
    await mod.autorizarCustoDespesaMeta(admin, { contaId: a.contaId, autorizada: false }, tx)
    const log = await linhas<{ tipo: string; grupo_id: string | null; conta_id: string | null; detalhe: Record<string, unknown> }>(
      tx, sql`select tipo, grupo_id, conta_id, detalhe from log_acoes where usuario_id = ${admin}`)
    // As quatro linhas saem na mesma transação (mesmo criado_em): compara o conjunto, não a ordem.
    const porTipo = (t: string) => log.filter(l => l.tipo === t)
    assert.deepEqual(porTipo('loja_motochefe_alterada').map(l => [l.grupo_id, l.conta_id]), [[a.grupoId, a.contaId], [a.grupoId, a.contaId]])
    assert.deepEqual(porTipo('autorizacao_conta_alterada').map(l => [l.grupo_id, l.conta_id]), [[null, a.contaId], [null, a.contaId]])
    assert.deepEqual(porTipo('loja_motochefe_alterada').map(l => [l.detalhe.de, l.detalhe.para]).sort(), [[false, true], [true, false]])
    assert.ok(porTipo('loja_motochefe_alterada').every(l => l.detalhe.lojaId === a.lojaId))
  })
})

test('listagem: traz as Contas de A e B com as suas lojas; Conta sem loja aparece vazia; desativada não aparece', async () => {
  await emTransacaoDesfeita(async tx => {
    const { a, b, lojaA2 } = await semear(tx)
    await mod.marcarLojaMotochefe(randomUUID(), { lojaId: a.lojaId, marcada: true }, tx)
    const vazia = await semearContaVazia(tx, { prefixo: P, nome: 'Vazia' })
    const desativada = await semearContaVazia(tx, { prefixo: P, nome: 'Desativada' })
    await tx.execute(sql`update contas set desativada_em = now() where id = ${desativada}`)
    // A listagem vê o banco inteiro (outros arquivos rodam em paralelo): filtra pelas Contas que este teste criou.
    const meus = (await mod.listarContasMotochefe(tx)).filter(c => [a.contaId, b.contaId, vazia, desativada].includes(c.id))
    assert.deepEqual(meus.map(c => c.id).sort(), [a.contaId, b.contaId, vazia].sort())
    const contaA = meus.find(c => c.id === a.contaId)!
    assert.deepEqual(contaA.lojas.map(l => [l.id, l.marcada]).sort(), [[a.lojaId, true], [lojaA2, false]].sort())
    assert.equal(meus.find(c => c.id === vazia)!.lojas.length, 0)
  })
})

// Loja de Conta desativada e loja de grupo inativo: a mesma frase de loja inexistente, e nada é gravado nem logado.
test('marcar loja de Conta desativada: "Loja não encontrada", nada gravado, sem log', async () => {
  await emTransacaoDesfeita(async tx => {
    const { a } = await semear(tx)
    await tx.execute(sql`update contas set desativada_em = now() where id = ${a.contaId}`)
    const admin = randomUUID()
    assert.deepEqual(await mod.marcarLojaMotochefe(admin, { lojaId: a.lojaId, marcada: true }, tx), { ok: false, erro: 'Loja não encontrada' })
    assert.equal(await marcadaDaLoja(tx, a.lojaId), false)
    assert.equal((await linhas(tx, sql`select 1 from log_acoes where usuario_id = ${admin}`)).length, 0)
  })
})

test('marcar loja de grupo inativo: "Loja não encontrada", nada gravado, sem log', async () => {
  await emTransacaoDesfeita(async tx => {
    const { a } = await semear(tx)
    await tx.execute(sql`update grupos set ativo = false where id = ${a.grupoId}`)
    const admin = randomUUID()
    assert.deepEqual(await mod.marcarLojaMotochefe(admin, { lojaId: a.lojaId, marcada: true }, tx), { ok: false, erro: 'Loja não encontrada' })
    assert.equal(await marcadaDaLoja(tx, a.lojaId), false)
    assert.equal((await linhas(tx, sql`select 1 from log_acoes where usuario_id = ${admin}`)).length, 0)
  })
})

test('listagem: loja de grupo inativo não aparece; a Conta continua, com as outras lojas', async () => {
  await emTransacaoDesfeita(async tx => {
    const { a, lojaA2 } = await semear(tx)
    // Segundo grupo da Conta A, inativo, com uma loja.
    const grupoInativo = await semearGrupo(tx, a.contaId, { prefixo: P, nome: 'Inativo', cnpj: cnpj() })
    await tx.execute(sql`update grupos set ativo = false where id = ${grupoInativo.grupoId}`)
    const minha = (await mod.listarContasMotochefe(tx)).find(c => c.id === a.contaId)!
    assert.deepEqual(minha.lojas.map(l => l.id).sort(), [a.lojaId, lojaA2].sort())
    assert.equal(minha.lojas.some(l => l.id === grupoInativo.lojaId), false)
  })
})


// Autorizar em Conta desativada: a mesma frase de Conta inexistente, e nada é gravado nem logado.
test('autorizar Conta desativada: "Conta não encontrada", nada gravado, sem log', async () => {
  await emTransacaoDesfeita(async tx => {
    const { a } = await semear(tx)
    await tx.execute(sql`update contas set desativada_em = now() where id = ${a.contaId}`)
    const admin = randomUUID()
    assert.deepEqual(await mod.autorizarCustoDespesaMeta(admin, { contaId: a.contaId, autorizada: true }, tx), { ok: false, erro: 'Conta não encontrada' })
    assert.equal(await autorizadaDaConta(tx, a.contaId), false)
    assert.equal((await linhas(tx, sql`select 1 from log_acoes where usuario_id = ${admin}`)).length, 0)
  })
})
