// Teste de banco: GET /api/v1/lojas (#319) chamado com um Request, com Contas reais no banco do test:db.
// Os dados são gravados de verdade e apagados no after. Chave válida usa validade futura (nunca validade nula),
// para não ocupar o índice api_chaves_atual_key que outros arquivos do test:db usam. Toda conferência filtra
// pelas lojas deste teste, porque os arquivos rodam em paralelo no mesmo banco.
import { after, before, mock, test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { NextRequest } from 'next/server'
import { apagarContasSemeadas, semearContaBase, semearLoja } from '@/test/semear-conta'
import { mockAfterDaResposta } from '@/test/after-resposta'

const url = process.env.TEST_DATABASE_URL
if (!url) throw new Error('TEST_DATABASE_URL não definida — este teste só roda num Postgres descartável')
if (!['localhost', '127.0.0.1'].includes(new URL(url).hostname)) {
  throw new Error('TEST_DATABASE_URL precisa ser loopback (Postgres descartável)')
}
process.env.DATABASE_URL = url

type Db = typeof import('@/lib/db')
type Schema = typeof import('@/lib/db/schema')
type Rota = typeof import('./route')
let db: Db['db']
let apiChaves: Schema['apiChaves']
let apiAcessos: Schema['apiAcessos']
let apiLimite: Schema['apiLimite']
let esperarRegistros: () => Promise<void>
let GET: Rota['GET']
let comChaveDaApi: typeof import('@/lib/queries/api-leitura')['comChaveDaApi']

const sha = (texto: string) => createHash('sha256').update(texto).digest('hex')
const HORA = 60 * 60 * 1000
const agora = () => Date.now()
const ERRO_DE_ACESSO = { codigo: 'acesso_negado', frase: 'Acesso negado.' }

const contasCriadas: string[] = []
const hashesCriados: string[] = []
// User agent único por chamada que o teste conta: o registro é conferido por ele, e o teardown apaga por ele.
const uasCriados: string[] = []
const uaNovo = (rotulo: string) => {
  const ua = `${rotulo}-${randomUUID()}`
  uasCriados.push(ua)
  return ua
}
const LOJA = {} as Record<'a1' | 'a2' | 'a3' | 'b1' | 'b2' | 'c1' | 'd1', string>
const CHAVE = {
  vigente: `vigente-${randomUUID()}`,
  trocada23h: `trocada23h-${randomUUID()}`,
  trocada25h: `trocada25h-${randomUUID()}`,
  vencida: `vencida-${randomUUID()}`,
  revogada: `revogada-${randomUUID()}`,
  // Uma chave por cenário de limite e de registro: o contador é por chave e por minuto.
  limite: `limite-${randomUUID()}`,
  minuto: `minuto-${randomUUID()}`,
  paralelo: `paralelo-${randomUUID()}`,
  duas: `duas-${randomUUID()}`,
  outra: `outra-${randomUUID()}`,
  registro: `registro-${randomUUID()}`,
}

const gravarChave = async (token: string, validaAte: Date | null, revogadaEm: Date | null = null) => {
  hashesCriados.push(sha(token))
  await db.insert(apiChaves).values({ hash: sha(token), geradaPor: randomUUID(), validaAte, revogadaEm })
}
const idDaChave = async (token: string) => {
  const [linha] = await db.select({ id: apiChaves.id }).from(apiChaves).where(eq(apiChaves.hash, sha(token)))
  return linha.id
}

// Tipo do corpo de qualquer resposta do endpoint: a lista de lojas (ou o erro).
type Corpo = { lojas?: { id: string, nome: string, cidade: string, endereco: string, cep: string | null, ativa: boolean }[] } & { codigo?: string, frase?: string }

const chamar = async (authorization: string | null, query = '', userAgent = uaNovo('teste')) => {
  const headers = new Headers({ 'user-agent': userAgent, 'x-forwarded-for': '200.1.2.3, 10.0.0.1' })
  if (authorization !== null) headers.set('authorization', authorization)
  const resposta = await GET(new NextRequest(`http://localhost/api/v1/lojas${query}`, { headers }))
  return {
    status: resposta.status,
    cacheControl: resposta.headers.get('cache-control'),
    retryAfter: resposta.headers.get('retry-after'),
    corpo: await resposta.json() as Corpo,
  }
}
const bearer = (token: string) => `Bearer ${token}`
const minhas = <T extends { id: string }>(lojas: T[] = []) => lojas.filter(l => Object.values(LOJA).includes(l.id))

before(async () => {
  ;({ esperarRegistros } = await mockAfterDaResposta())
  ;({ db } = await import('@/lib/db'))
  ;({ apiChaves, apiAcessos, apiLimite } = await import('@/lib/db/schema'))
  ;({ GET } = await import('./route'))
  ;({ comChaveDaApi } = await import('@/lib/queries/api-leitura'))

  const conta = async (prefixo: string, cnpj: string) => {
    const base = await semearContaBase(db, { prefixo, nome: `Conta ${prefixo}`, cnpj })
    contasCriadas.push(base.contaId)
    return base
  }
  const marcar = (ids: string[]) => db.execute(sql`update lojas set loja_motochefe = true where id = any(${sql.param(ids)}::uuid[])`)

  const A = await conta('API319A', '31901000000001')
  LOJA.a1 = A.lojaId
  LOJA.a2 = await semearLoja(db, A.grupoId, 'Loja API319 A2')
  LOJA.a3 = await semearLoja(db, A.grupoId, 'Loja API319 A3')
  await db.execute(sql`update lojas set cep = '30140071' where id = ${LOJA.a1}`)
  await db.execute(sql`update lojas set ativa = false where id = ${LOJA.a3}`)
  await marcar([LOJA.a1, LOJA.a3])

  const B = await conta('API319B', '31902000000002')
  LOJA.b1 = B.lojaId
  LOJA.b2 = await semearLoja(db, B.grupoId, 'Loja API319 B2')
  await marcar([LOJA.b1])

  // Conta desativada: a loja marcada não sai (cenário 23a).
  const C = await conta('API319C', '31903000000003')
  LOJA.c1 = C.lojaId
  await db.execute(sql`update contas set desativada_em = now() where id = ${C.contaId}`)
  await marcar([LOJA.c1])

  // Grupo inativo: a loja marcada não sai (cenário 23b).
  const D = await conta('API319D', '31904000000004')
  LOJA.d1 = D.lojaId
  await db.execute(sql`update grupos set ativo = false where id = ${D.grupoId}`)
  await marcar([LOJA.d1])

  await gravarChave(CHAVE.vigente, new Date(agora() + 365 * 24 * HORA))
  await gravarChave(CHAVE.trocada23h, new Date(agora() + 23 * HORA))
  await gravarChave(CHAVE.trocada25h, new Date(agora() - HORA))
  await gravarChave(CHAVE.vencida, new Date(agora() - 24 * HORA))
  await gravarChave(CHAVE.revogada, new Date(agora() + 365 * 24 * HORA), new Date(agora() - HORA))
  for (const token of [CHAVE.limite, CHAVE.minuto, CHAVE.paralelo, CHAVE.duas, CHAVE.outra, CHAVE.registro]) {
    await gravarChave(token, new Date(agora() + 365 * 24 * HORA))
  }
})

after(async () => {
  const ids = (await db.select({ id: apiChaves.id }).from(apiChaves).where(inArray(apiChaves.hash, hashesCriados))).map(l => l.id)
  if (ids.length > 0) {
    await db.delete(apiAcessos).where(inArray(apiAcessos.chaveId, ids))
    await db.delete(apiLimite).where(inArray(apiLimite.chaveId, ids))
  }
  await db.delete(apiAcessos).where(inArray(apiAcessos.userAgent, uasCriados))
  await db.delete(apiChaves).where(inArray(apiChaves.hash, hashesCriados))
  await apagarContasSemeadas(db, { contaIds: contasCriadas, prefixo: 'api319' })
  await (globalThis as { __pgPool?: { end(): Promise<void> } }).__pgPool?.end()
})

test('chave vigente: sai só o que está marcado, com as seis colunas', async () => {
  const { status, cacheControl, corpo } = await chamar(bearer(CHAVE.vigente))
  assert.equal(status, 200)
  assert.equal(cacheControl, 'no-store', 'resposta 200 pode ser guardada por cache')
  assert.deepEqual(minhas(corpo.lojas).map(l => l.id).sort(), [LOJA.a1, LOJA.a3, LOJA.b1].sort())
  const a1 = minhas(corpo.lojas).find(l => l.id === LOJA.a1)
  assert.ok(a1)
  assert.deepEqual(Object.keys(a1).sort(), ['ativa', 'cep', 'cidade', 'endereco', 'id', 'nome'])
  assert.equal(a1.cep, '30140071')
  assert.equal(a1.ativa, true)
})

test('loja marcada e desativada continua saindo, com ativa falso', async () => {
  const { corpo } = await chamar(bearer(CHAVE.vigente))
  assert.equal(minhas(corpo.lojas).find(l => l.id === LOJA.a3)?.ativa, false)
})

test('loja não marcada, da mesma Conta ou de outra, não sai', async () => {
  const { corpo } = await chamar(bearer(CHAVE.vigente))
  const ids = minhas(corpo.lojas).map(l => l.id)
  assert.ok(ids.includes(LOJA.a1) && ids.includes(LOJA.b1), 'controle: as lojas marcadas deveriam sair')
  assert.equal(ids.includes(LOJA.a2), false)
  assert.equal(ids.includes(LOJA.b2), false)
})

test('chave trocada há 23 horas ainda passa', async () => {
  const { status, corpo } = await chamar(bearer(CHAVE.trocada23h))
  assert.equal(status, 200)
  assert.ok(minhas(corpo.lojas).some(l => l.id === LOJA.a1))
})

test('ausente, errada, revogada, vencida, trocada há 25 horas ou sem o prefixo Bearer: 401 com o mesmo corpo', async () => {
  const casos: [string, string | null][] = [
    ['sem Authorization', null],
    ['chave errada', bearer('nao-existe-000')],
    ['chave revogada', bearer(CHAVE.revogada)],
    ['chave vencida', bearer(CHAVE.vencida)],
    ['trocada há 25 horas', bearer(CHAVE.trocada25h)],
    ['sem o prefixo Bearer', CHAVE.vigente],
  ]
  for (const [nome, authorization] of casos) {
    const { status, cacheControl, corpo } = await chamar(authorization)
    assert.equal(status, 401, nome)
    assert.equal(cacheControl, 'no-store', nome)
    assert.deepEqual(corpo, ERRO_DE_ACESSO, nome)
  }
})

test('parâmetro de loja, grupo ou Conta na URL não amplia o que sai', async () => {
  const semPedido = minhas((await chamar(bearer(CHAVE.vigente))).corpo.lojas).map(l => l.id).sort()
  assert.ok(semPedido.includes(LOJA.a1), 'controle: a loja marcada deveria sair')
  const comPedido = await chamar(bearer(CHAVE.vigente), `?lojaId=${LOJA.b2}&grupoId=${LOJA.b2}&contaId=${LOJA.a2}`)
  assert.equal(comPedido.status, 200)
  assert.deepEqual(minhas(comPedido.corpo.lojas).map(l => l.id).sort(), semPedido)
})

test('Conta desativada e grupo inativo: as lojas marcadas delas não saem', async () => {
  const ids = minhas((await chamar(bearer(CHAVE.vigente))).corpo.lojas).map(l => l.id)
  assert.ok(ids.includes(LOJA.a1), 'controle: a loja de Conta ativa deveria sair')
  assert.equal(ids.includes(LOJA.c1), false, 'loja de Conta desativada saiu')
  assert.equal(ids.includes(LOJA.d1), false, 'loja de grupo inativo saiu')
})

test('desmarcar a loja tira ela da consulta seguinte', async () => {
  const antes = minhas((await chamar(bearer(CHAVE.vigente))).corpo.lojas).map(l => l.id)
  assert.ok(antes.includes(LOJA.a1))
  await db.execute(sql`update lojas set loja_motochefe = false where id = ${LOJA.a1}`)
  try {
    const depois = minhas((await chamar(bearer(CHAVE.vigente))).corpo.lojas).map(l => l.id)
    assert.equal(depois.includes(LOJA.a1), false)
  } finally {
    await db.execute(sql`update lojas set loja_motochefe = true where id = ${LOJA.a1}`)
  }
})

// Prova o catch da casca comChaveDaApi: o miolo lança depois de a chave conferir. Não simula falha do banco.
test('falha depois da chave: 500 com a frase fixa, e o log só leva a frase constante', async () => {
  const espiao = mock.method(console, 'error', () => {})
  try {
    const ua = uaNovo('falha')
    const cabecalhos = new Headers({ authorization: bearer(CHAVE.vigente), 'user-agent': ua })
    const resposta = await comChaveDaApi(cabecalhos, '/api/v1/lojas', async () => { throw new Error(`segredo ${CHAVE.vigente}`) })
    await esperarRegistros()
    assert.equal(resposta.status, 500)
    assert.deepEqual(resposta.corpo, { codigo: 'erro_interno', frase: 'Erro interno.' })
    assert.deepEqual(espiao.mock.calls.map(c => c.arguments), [['api de leitura: erro interno']])
    const linhas = await linhasDoUa(ua)
    assert.equal(linhas.length, 1, 'a falha do miolo não gerou a linha do registro')
    assert.equal(linhas[0].status, 500)
    assert.equal(linhas[0].chaveId, await idDaChave(CHAVE.vigente))
  } finally {
    espiao.mock.restore()
  }
})

// Limite e registro (#320). O relógio fica num ponto fixo a 30 s dentro de um minuto, para o contador e o
// Retry-After não dependerem da hora em que o teste roda. Cada cenário usa a própria chave.
const tempoFixo = () => {
  const inicio = Math.floor(Date.now() / 60000) * 60000 + 30000
  mock.timers.enable({ apis: ['Date'], now: inicio })
  return inicio
}
const janelaDo = (instante: number) => new Date(Math.floor(instante / 60000) * 60000)
const linhasDoUa = (ua: string) => db.select().from(apiAcessos).where(eq(apiAcessos.userAgent, ua))
const semearContador = async (token: string, pedidos: number, janela: Date) => {
  await db.insert(apiLimite).values({ chaveId: await idDaChave(token), janela, pedidos })
}
const LIMITE_RECUSADO = { codigo: 'limite_atingido', frase: 'Limite de chamadas atingido.' }
// Teto da spec #315, copiado aqui (não importado): o vermelho do teste fica de comportamento, não de export ausente.
const TETO = 60

test('limite: o 61º pedido da chave no minuto recebe 429 com Retry-After e sem lojas; o registro guarda os 61 pedidos', async () => {
  const ua = uaNovo('limite')
  tempoFixo()
  try {
    for (let n = 1; n <= TETO; n++) {
      assert.equal((await chamar(bearer(CHAVE.limite), '', ua)).status, 200, `pedido ${n}`)
    }
    const recusado = await chamar(bearer(CHAVE.limite), '', ua)
    assert.equal(recusado.status, 429)
    assert.deepEqual(recusado.corpo, LIMITE_RECUSADO)
    assert.equal('lojas' in recusado.corpo, false, 'a recusa não pode trazer lojas')
    assert.equal(recusado.retryAfter, '30', 'relógio em :30: faltam 30 s para a janela seguinte')
    await esperarRegistros()
    const linhas = await linhasDoUa(ua)
    assert.equal(linhas.length, TETO + 1)
    assert.equal(linhas.filter(l => l.status === 200).length, TETO)
    assert.equal(linhas.filter(l => l.status === 429).length, 1)
  } finally {
    mock.timers.reset()
  }
})

test('limite: no minuto seguinte a mesma chave volta a receber 200', async () => {
  const inicio = tempoFixo()
  try {
    for (let n = 1; n <= TETO; n++) await chamar(bearer(CHAVE.minuto))
    assert.equal((await chamar(bearer(CHAVE.minuto))).status, 429)
    mock.timers.setTime(inicio + 60000)
    assert.equal((await chamar(bearer(CHAVE.minuto))).status, 200)
  } finally {
    mock.timers.reset()
  }
})

test('contador: 20 pedidos em paralelo com 5 vagas no minuto: exatamente 5 passam e o contador fecha em 75', async () => {
  const inicio = tempoFixo()
  try {
    await semearContador(CHAVE.paralelo, TETO - 5, janelaDo(inicio))
    const respostas = await Promise.all(Array.from({ length: 20 }, () => chamar(bearer(CHAVE.paralelo))))
    assert.equal(respostas.filter(r => r.status === 200).length, 5)
    assert.equal(respostas.filter(r => r.status === 429).length, 15)
    const [contador] = await db.select({ pedidos: apiLimite.pedidos }).from(apiLimite).where(and(
      eq(apiLimite.chaveId, await idDaChave(CHAVE.paralelo)),
      eq(apiLimite.janela, janelaDo(inicio)),
    ))
    assert.equal(contador.pedidos, TETO + 15)
  } finally {
    mock.timers.reset()
  }
})

test('contador: cada chave tem o seu; a chave esgotada recebe 429 e a outra segue com 200 no mesmo minuto', async () => {
  const inicio = tempoFixo()
  try {
    await semearContador(CHAVE.duas, TETO, janelaDo(inicio))
    assert.equal((await chamar(bearer(CHAVE.duas))).status, 429)
    assert.equal((await chamar(bearer(CHAVE.outra))).status, 200)
  } finally {
    mock.timers.reset()
  }
})

test('registro: chamada sem chave gera uma linha sem chave, com status 401 e o IP do pedido', async () => {
  const ua = uaNovo('registro-sem-chave')
  await chamar(null, '', ua)
  await esperarRegistros()
  const [linha] = await linhasDoUa(ua)
  assert.ok(linha, 'a recusa não foi registrada')
  assert.equal(linha.chaveId, null)
  assert.equal(linha.status, 401)
  assert.equal(linha.ip, '200.1.2.3')
  assert.equal(linha.endpoint, '/api/v1/lojas')
})

test('registro: chave válida gera uma linha com a chave, status 200 e a quantidade de lojas; o token não entra na linha', async () => {
  const ua = uaNovo('registro-com-chave')
  const { status, corpo } = await chamar(bearer(CHAVE.registro), '', ua)
  assert.equal(status, 200)
  await esperarRegistros()
  const [linha] = await linhasDoUa(ua)
  assert.ok(linha, 'o acesso não foi registrado')
  assert.equal(linha.chaveId, await idDaChave(CHAVE.registro))
  assert.equal(linha.status, 200)
  assert.equal(linha.linhas, corpo.lojas?.length)
  assert.equal(linha.periodoIni, null)
  assert.equal(linha.pagina, null)
  const texto = JSON.stringify(linha)
  assert.equal(texto.includes(CHAVE.registro), false, 'o token foi gravado')
  assert.equal(texto.includes('Bearer'), false, 'o cabeçalho Authorization foi gravado')
})
