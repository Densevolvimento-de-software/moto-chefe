// Teste de banco: troca e conferência de chave da API de leitura (#319). Tudo roda dentro de transação que se
// desfaz, como o api-leitura-migracao.db.test.ts: nenhuma chave atual fica commitada no banco do test:db, porque
// o índice api_chaves_atual_key é global e o outro arquivo espera ele vazio.
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'

const url = process.env.TEST_DATABASE_URL
if (!url) throw new Error('TEST_DATABASE_URL não definida — este teste só roda num Postgres descartável')
if (!['localhost', '127.0.0.1'].includes(new URL(url).hostname)) {
  throw new Error('TEST_DATABASE_URL precisa ser loopback (Postgres descartável)')
}
process.env.DATABASE_URL = url

type Db = typeof import('@/lib/db')
type Consulta = typeof import('@/lib/queries/api-leitura')
type Schema = typeof import('@/lib/db/schema')
let db: Db['db']
let consulta: Consulta
let apiChaves: Schema['apiChaves']
type Tx = Parameters<Parameters<Db['db']['transaction']>[0]>[0]

before(async () => {
  ;({ db } = await import('@/lib/db'))
  consulta = await import('@/lib/queries/api-leitura')
  ;({ apiChaves } = await import('@/lib/db/schema'))
})

after(async () => {
  await (globalThis as { __pgPool?: { end(): Promise<void> } }).__pgPool?.end()
})

class Desfazer extends Error {}
const desfazendo = (corpo: (tx: Tx) => Promise<void>) =>
  assert.rejects(db.transaction(async tx => { await corpo(tx); throw new Desfazer() }), Desfazer)

const sha = (texto: string) => createHash('sha256').update(texto).digest('hex')
const HORA = 60 * 60 * 1000
// Conferência por id: o teste compara só se a chave foi aceita, o id é conferido no teste de id.
const confere = async (token: string, agora: Date, tx: Tx) => (await consulta.buscarChaveAceita(token, agora, tx)) !== null
const T1 = new Date()
const emHoras = (h: number, base: Date = T1) => new Date(base.getTime() + h * HORA)

test('troca grava só o hash da chave e devolve a chave em texto', async () => {
  await desfazendo(async tx => {
    const chave = await consulta.trocarChave({ geradaPor: randomUUID(), agora: T1 }, tx)
    const [linha] = await tx.select().from(apiChaves).where(eq(apiChaves.hash, sha(chave)))
    assert.ok(linha, 'o hash da chave devolvida não está gravado')
    assert.equal(JSON.stringify(linha).includes(chave), false, 'a chave em texto foi gravada')
  })
})

test('primeira troca: a chave nova confere agora', async () => {
  await desfazendo(async tx => {
    const chave = await consulta.trocarChave({ geradaPor: randomUUID(), agora: T1 }, tx)
    const [linha] = await tx.select().from(apiChaves).where(eq(apiChaves.hash, sha(chave)))
    assert.deepEqual(await consulta.buscarChaveAceita(chave, T1, tx), { id: linha.id })
    assert.equal(await confere(chave, T1, tx), true)
  })
})

test('segunda troca: a anterior fica em carência e ainda confere dentro das 24 horas', async () => {
  await desfazendo(async tx => {
    const primeira = await consulta.trocarChave({ geradaPor: randomUUID(), agora: T1 }, tx)
    const segunda = await consulta.trocarChave({ geradaPor: randomUUID(), agora: emHoras(1) }, tx)
    assert.equal(await confere(primeira, emHoras(2), tx), true)
    assert.equal(await confere(segunda, emHoras(2), tx), true)
  })
})

test('segunda troca: a anterior deixa de conferir depois das 24 horas da carência', async () => {
  await desfazendo(async tx => {
    const primeira = await consulta.trocarChave({ geradaPor: randomUUID(), agora: T1 }, tx)
    await consulta.trocarChave({ geradaPor: randomUUID(), agora: emHoras(1) }, tx)
    assert.equal(await confere(primeira, emHoras(2), tx), true, 'controle: ainda em carência')
    assert.equal(await confere(primeira, emHoras(26), tx), false)
  })
})

test('terceira troca dentro de 24 horas revoga a chave em carência na hora', async () => {
  await desfazendo(async tx => {
    const primeira = await consulta.trocarChave({ geradaPor: randomUUID(), agora: T1 }, tx)
    const segunda = await consulta.trocarChave({ geradaPor: randomUUID(), agora: emHoras(1) }, tx)
    const terceira = await consulta.trocarChave({ geradaPor: randomUUID(), agora: emHoras(2) }, tx)
    assert.equal(await confere(primeira, emHoras(2), tx), false, 'a 1ª sobreviveu à 3ª troca')
    assert.equal(await confere(segunda, emHoras(2), tx), true, 'a 2ª (em carência) deveria valer')
    assert.equal(await confere(terceira, emHoras(2), tx), true, 'a nova deveria valer')
  })
})

test('duas chaves atuais com escrita real dão erro 23505 pelo índice api_chaves_atual_key', async () => {
  // Sempre se desfaz: se o índice não barrar, a segunda atual não pode ficar commitada.
  const erro = await db.transaction(async tx => {
    await consulta.trocarChave({ geradaPor: randomUUID(), agora: T1 }, tx)
    await tx.insert(apiChaves).values({ hash: sha(randomUUID()), geradaPor: randomUUID() })
    throw new Desfazer()
  }).catch((e: unknown) => e)
  const causa = (erro as { cause?: { code?: string, constraint?: string } } | null)?.cause
  assert.equal(causa?.code, '23505')
  assert.equal(causa?.constraint, 'api_chaves_atual_key')
})

// Linha com o hash fixo do caminho sem token, com validade futura (não é atual): sem token, nunca confere.
test('sem token nunca confere, mesmo com uma linha que tem o hash fixo do caminho sem token', async () => {
  await desfazendo(async tx => {
    await tx.insert(apiChaves).values({ hash: '0'.repeat(64), geradaPor: randomUUID(), validaAte: emHoras(24) })
    assert.equal(await consulta.buscarChaveAceita(null, T1, tx), null)
  })
})
