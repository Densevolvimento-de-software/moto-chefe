// Teste de banco: troca e conferência de chave da API de leitura (#319). Tudo roda dentro de transação que se
// desfaz, como o api-leitura-migracao.db.test.ts: nenhuma chave atual fica commitada no banco do test:db, porque
// o índice api_chaves_atual_key é global e o outro arquivo espera ele vazio.
import { after, before, mock, test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { eq, sql } from 'drizzle-orm'
import { NextRequest } from 'next/server'
import { mockAfterDaResposta } from '@/test/after-resposta'

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
let apiAcessos: Schema['apiAcessos']
let apiLimite: Schema['apiLimite']
let cron: typeof import('@/app/api/cron/log-acoes/route')
let esperarRegistros: () => Promise<void>
type Tx = Parameters<Parameters<Db['db']['transaction']>[0]>[0]

before(async () => {
  ;({ esperarRegistros } = await mockAfterDaResposta())
  ;({ db } = await import('@/lib/db'))
  consulta = await import('@/lib/queries/api-leitura')
  ;({ apiChaves, apiAcessos, apiLimite } = await import('@/lib/db/schema'))
  cron = await import('@/app/api/cron/log-acoes/route')
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

// Registro e limpeza (#320). Chaves com validade futura, para não ocupar o índice api_chaves_atual_key; cada
// conferência filtra pela chave que o teste criou, porque os arquivos do test:db rodam em paralelo.
const CRON_SEGREDO = `cron-${randomUUID()}`
process.env.CRON_SECRET = CRON_SEGREDO
const pedidoDoCron = () => new NextRequest('http://localhost/api/cron/log-acoes', {
  headers: { authorization: `Bearer ${CRON_SEGREDO}` },
})
const chaveDeTeste = async () => {
  const token = `teste-320-${randomUUID()}`
  const [linha] = await db.insert(apiChaves).values({ hash: sha(token), geradaPor: randomUUID(), validaAte: emHoras(24 * 365) })
    .returning({ id: apiChaves.id })
  return { token, id: linha.id }
}
const apagarChaveDeTeste = async (id: string) => {
  await db.delete(apiAcessos).where(eq(apiAcessos.chaveId, id))
  await db.delete(apiLimite).where(eq(apiLimite.chaveId, id))
  await db.delete(apiChaves).where(eq(apiChaves.id, id))
}

test('falha ao gravar o registro não derruba a resposta: 200 igual, e o log leva só a frase fixa', async () => {
  const chave = await chaveDeTeste()
  const espiao = mock.method(console, 'error', () => {})
  try {
    const cabecalhos = new Headers({ authorization: `Bearer ${chave.token}` })
    // Pagina fora do int4: o banco recusa a linha do registro, e a resposta não pode mudar por isso.
    const resposta = await consulta.comChaveDaApi(cabecalhos, '/api/v1/teste', async () => ({ corpo: { ok: true }, linhas: 0, pagina: 3_000_000_000 }), T1)
    assert.equal(resposta.status, 200)
    assert.deepEqual(resposta.corpo, { ok: true })
    await esperarRegistros()
    assert.deepEqual(espiao.mock.calls.map(c => c.arguments), [['api de leitura: registro de acesso não gravado']])
  } finally {
    espiao.mock.restore()
    await apagarChaveDeTeste(chave.id)
  }
})

test('limpeza pelo cron: registro de acesso de 12 meses e 1 dia sai; o de 11 meses e 28 dias fica', async () => {
  const ua = `limpeza-${randomUUID()}`
  await db.execute(sql`insert into api_acessos (chave_id, endpoint, status, user_agent, criado_em) values
    (null, '/api/v1/teste', 401, ${ua}, now() - interval '12 months 1 day'),
    (null, '/api/v1/teste', 401, ${ua}, now() - interval '11 months 28 days')`)
  try {
    const resposta = await cron.GET(pedidoDoCron())
    assert.equal(resposta.status, 200)
    const restantes = await db.select({ id: apiAcessos.id }).from(apiAcessos).where(eq(apiAcessos.userAgent, ua))
    assert.equal(restantes.length, 1)
  } finally {
    await db.delete(apiAcessos).where(eq(apiAcessos.userAgent, ua))
  }
})

test('limpeza pelo cron: janela do contador de mais de 1 dia sai; a janela atual fica', async () => {
  const chave = await chaveDeTeste()
  const minuto = new Date(Math.floor(Date.now() / 60000) * 60000)
  await db.insert(apiLimite).values([
    { chaveId: chave.id, janela: new Date(minuto.getTime() - 2 * 24 * HORA), pedidos: 3 },
    { chaveId: chave.id, janela: minuto, pedidos: 1 },
  ])
  try {
    const resposta = await cron.GET(pedidoDoCron())
    assert.equal(resposta.status, 200)
    const restantes = await db.select({ janela: apiLimite.janela }).from(apiLimite).where(eq(apiLimite.chaveId, chave.id))
    assert.deepEqual(restantes.map(l => l.janela.getTime()), [minuto.getTime()])
  } finally {
    await apagarChaveDeTeste(chave.id)
  }
})
