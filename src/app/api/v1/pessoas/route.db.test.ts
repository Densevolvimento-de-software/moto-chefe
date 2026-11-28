// Teste de banco: GET /api/v1/pessoas (#324) chamado com um Request, no banco do test:db. Dados gravados de verdade e
// apagados no after. Os arquivos do test:db rodam em paralelo no mesmo banco: a lista da API é global, então cada
// conferência usa só os ids que este teste criou, e a paginação percorre todas as páginas.
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { NextRequest } from 'next/server'
import { apagarContasSemeadas, type Base } from '@/test/semear-conta'
import { semearChaveDaApi, semearContaDaApi, semearLojaDaApi } from '@/test/api-leitura-semear'
import { mockAfterDaResposta } from '@/test/after-resposta'
import { ehPessoaQueSai } from '@/lib/api-leitura-pessoas'
import type { PapelBase } from '@/lib/gestao-usuarios'

const url = process.env.TEST_DATABASE_URL
if (!url) throw new Error('TEST_DATABASE_URL não definida — este teste só roda num Postgres descartável')
if (!['localhost', '127.0.0.1'].includes(new URL(url).hostname)) {
  throw new Error('TEST_DATABASE_URL precisa ser loopback (Postgres descartável)')
}
process.env.DATABASE_URL = url

type Db = typeof import('@/lib/db')
type Rota = typeof import('./route')
let db: Db['db']
let execRows: Db['execRows']
let esperarRegistros: () => Promise<void>
let GET: Rota['GET']

const ENDPOINT = '/api/v1/pessoas'
const sha = (texto: string) => createHash('sha256').update(texto).digest('hex')
const CHAVE = `chave-pe324-${randomUUID()}`
const hashes: string[] = []
const uas: string[] = []
const contaIds: string[] = []
const prefixos: string[] = []
const pessoaIds: string[] = []
const EMAILS_DA_MARCA: string[] = []

// Dados de contato do funcionário: nenhum pode sair em nenhuma resposta.
const MARCA = 'EmailUnico324'
const CPF_UNICO = '77788899900'
const PIX_UNICO = 'pix-unico-324@teste.invalid'

type Pessoa = { id: string; nome: string; funcao: string; loja: { id: string; nome: string } | null; ativo: boolean }
type Corpo = { pessoas?: Pessoa[]; proximaPagina?: string | null; codigo?: string; frase?: string }

async function gravarChave(token: string) {
  hashes.push(sha(token))
  await semearChaveDaApi(db, token)
}

function uaNovo(): string {
  const ua = `pe324-${randomUUID()}`
  uas.push(ua)
  return ua
}

async function chamar(query: string, token: string | null = CHAVE) {
  const ua = uaNovo()
  const headers = new Headers({ 'user-agent': ua, 'x-forwarded-for': '200.3.2.4' })
  if (token !== null) headers.set('authorization', `Bearer ${token}`)
  const resposta = await GET(new NextRequest(`http://localhost${ENDPOINT}${query}`, { headers }))
  const texto = await resposta.text()
  return { status: resposta.status, texto, corpo: JSON.parse(texto) as Corpo, ua }
}

/** Percorre todas as páginas. Devolve as pessoas na ordem da API e o texto cru de cada página. */
async function todasAsPaginas(): Promise<{ pessoas: Pessoa[]; textos: string[] }> {
  const pessoas: Pessoa[] = []
  const textos: string[] = []
  let cursor: string | null = null
  for (let guarda = 0; guarda < 200; guarda++) {
    const query: string = cursor === null ? '' : `?cursor=${encodeURIComponent(cursor)}`
    const r = await chamar(query)
    assert.equal(r.status, 200, r.texto)
    textos.push(r.texto)
    pessoas.push(...(r.corpo.pessoas ?? []))
    if (!r.corpo.proximaPagina) return { pessoas, textos }
    cursor = r.corpo.proximaPagina
  }
  throw new Error('paginação sem fim')
}

type Candidato = { id: string; papel: string; cargo: { nome: string; papelBase: PapelBase } | null; lojaQueSai: boolean; contaQueSai: boolean }
const candidatos: Candidato[] = []

async function semearConta(letra: string, cnpj: string, opcoes: { desativada?: boolean; grupoInativo?: boolean } = {}): Promise<Base> {
  const prefixo = `PE324${letra}`
  const base = await semearContaDaApi(db, { prefixo, cnpj, ...opcoes })
  contaIds.push(base.contaId)
  prefixos.push(prefixo)
  return base
}

async function semearLoja(base: Base, nome: string, marcada: boolean): Promise<string> {
  return semearLojaDaApi(db, base.grupoId, nome, { marcada })
}

async function cargoDe(contaId: string, nome: string, papelBase: string): Promise<string> {
  const [linha] = await execRows(sql`insert into cargos (conta_id, nome, papel_base) values (${contaId}, ${nome}, ${papelBase}) returning id`)
  return linha.id as string
}

/** Usuário com e-mail que a limpeza da Conta reconhece (`-pe324x-`). `marca` põe o e-mail na lista de textos proibidos. */
async function semearPessoa(
  base: Base, prefixo: string, nome: string,
  o: { papel: string; lojaId?: string | null; contaId?: string | null; ativo?: boolean; cargoId?: string | null; extras?: string[]; id?: string; marca?: boolean },
): Promise<string> {
  const id = o.id ?? randomUUID()
  const email = `${o.marca ? MARCA.toLowerCase() : 'pessoa'}-${prefixo.toLowerCase()}-${randomUUID()}@teste.invalid`
  if (o.marca) EMAILS_DA_MARCA.push(email)
  const lojaId = o.lojaId === undefined ? base.lojaId : o.lojaId
  const contaId = o.contaId === undefined ? base.contaId : o.contaId
  await execRows(sql`insert into usuarios (id, nome, email, papel, papeis_extras, loja_id, conta_id, cargo_id, ativo)
    values (${id}, ${nome}, ${email}, ${o.papel}, ${sql.param(o.extras ?? [])}::text[], ${lojaId}, ${contaId}, ${o.cargoId ?? null}, ${o.ativo ?? true})`)
  pessoaIds.push(id)
  return id
}

let A: Base, B: Base, C: Base, D: Base
let A1: string, A2: string, B2: string, C1: string, D1: string
let vendedorAtivo: string, mecanicoSaiu: string, auxiliar: string, socioA: string, socioB: string, adminGeralSemLoja: string
let cargoMecanico: string, cargoSocio: string, papelExtra: string
let vendedorA2: string, vendedorB: string, vendedorC: string, vendedorD: string, pessoaComDados: string
let f1: string, f2: string, f3: string

before(async () => {
  ;({ esperarRegistros } = await mockAfterDaResposta())
  ;({ db, execRows } = await import('@/lib/db'))
  ;({ GET } = await import('./route'))

  A = await semearConta('A', '32324000000001')
  B = await semearConta('B', '32324000000002')
  C = await semearConta('C', '32324000000003', { desativada: true })
  D = await semearConta('D', '32324000000004', { grupoInativo: true })
  A1 = await semearLoja(A, 'Loja 324 A1', true)
  A2 = A.lojaId
  B2 = B.lojaId
  C1 = await semearLoja(C, 'Loja 324 C1', true)
  D1 = await semearLoja(D, 'Loja 324 D1', true)
  await gravarChave(CHAVE)

  // Conta A tem loja que sai (A1): sócio da Conta A entra, com loja nula. Conta B só tem loja não marcada: sócio de B fica de fora.
  vendedorAtivo = await semearPessoa(A, 'pe324a', 'Vendedora Sintética 324', { papel: 'vendedor', lojaId: A1, marca: true })
  mecanicoSaiu = await semearPessoa(A, 'pe324a', 'Mecânico Sintético Saiu 324', { papel: 'mecanico', lojaId: A1, ativo: false })
  auxiliar = await semearPessoa(A, 'pe324a', 'Auxiliar Sintético 324', { papel: 'aux_adm', lojaId: A1 })
  socioA = await semearPessoa(A, 'pe324a', 'Sócio Sintético 324', { papel: 'admin_socio', lojaId: A2 })
  socioB = await semearPessoa(B, 'pe324b', 'Sócio Outra Conta 324', { papel: 'admin_socio', lojaId: B2 })
  adminGeralSemLoja = await semearPessoa(A, 'pe324a', 'Plataforma Sintética 324', { papel: 'admin_geral', lojaId: null, contaId: null })
  papelExtra = await semearPessoa(A, 'pe324a', 'Auxiliar com Extra 324', { papel: 'aux_adm', lojaId: A1, extras: ['vendedor'] })
  const cargoMec = await cargoDe(A.contaId, 'Chefe de oficina 324', 'mecanico')
  const cargoSoc = await cargoDe(A.contaId, 'Sócio de cargo 324', 'admin_socio')
  cargoMecanico = await semearPessoa(A, 'pe324a', 'Cargo Mecânico 324', { papel: 'cargo', lojaId: A1, cargoId: cargoMec })
  cargoSocio = await semearPessoa(A, 'pe324a', 'Cargo Sócio 324', { papel: 'cargo', lojaId: A1, cargoId: cargoSoc })

  // Fora: loja não marcada da mesma Conta, outra Conta, Conta desativada e grupo inativo.
  vendedorA2 = await semearPessoa(A, 'pe324a', 'Vendedora Loja Não Marcada 324', { papel: 'vendedor', lojaId: A2 })
  vendedorB = await semearPessoa(B, 'pe324b', 'Vendedor Outra Conta 324', { papel: 'vendedor', lojaId: B2 })
  vendedorC = await semearPessoa(C, 'pe324c', 'Vendedor Conta Desativada 324', { papel: 'vendedor', lojaId: C1 })
  vendedorD = await semearPessoa(D, 'pe324d', 'Vendedor Grupo Inativo 324', { papel: 'vendedor', lojaId: D1 })

  // Mesma Conta, marcada: e-mail, CPF e PIX que não podem sair em nenhuma resposta.
  pessoaComDados = await semearPessoa(A, 'pe324a', 'Pessoa Com Dados 324', { papel: 'vendedor', lojaId: A1, marca: true })
  await execRows(sql`insert into usuarios_dados (usuario_id, cpf, pix_tipo, pix_chave, data_nascimento)
    values (${pessoaComDados}, ${CPF_UNICO}, 'email', ${PIX_UNICO}, '1990-01-01')`)

  // Três pessoas com ids em ordem decrescente, inseridas do maior para o menor: a ordem por id tem de vencer a de inserção.
  f3 = await semearPessoa(A, 'pe324a', 'Ordem 324 três', { papel: 'mecanico', lojaId: A1, id: '00000324-0000-4000-8000-fffffffffff3' })
  f2 = await semearPessoa(A, 'pe324a', 'Ordem 324 dois', { papel: 'mecanico', lojaId: A1, id: '00000324-0000-4000-8000-fffffffffff2' })
  f1 = await semearPessoa(A, 'pe324a', 'Ordem 324 um', { papel: 'mecanico', lojaId: A1, id: '00000324-0000-4000-8000-fffffffffff1' })

  candidatos.push(
    { id: vendedorAtivo, papel: 'vendedor', cargo: null, lojaQueSai: true, contaQueSai: true },
    { id: mecanicoSaiu, papel: 'mecanico', cargo: null, lojaQueSai: true, contaQueSai: true },
    { id: auxiliar, papel: 'aux_adm', cargo: null, lojaQueSai: true, contaQueSai: true },
    { id: socioA, papel: 'admin_socio', cargo: null, lojaQueSai: false, contaQueSai: true },
    { id: socioB, papel: 'admin_socio', cargo: null, lojaQueSai: false, contaQueSai: false },
    { id: adminGeralSemLoja, papel: 'admin_geral', cargo: null, lojaQueSai: false, contaQueSai: false },
    { id: papelExtra, papel: 'aux_adm', cargo: null, lojaQueSai: true, contaQueSai: true },
    { id: cargoMecanico, papel: 'cargo', cargo: { nome: 'Chefe de oficina 324', papelBase: 'mecanico' }, lojaQueSai: true, contaQueSai: true },
    { id: cargoSocio, papel: 'cargo', cargo: { nome: 'Sócio de cargo 324', papelBase: 'admin_socio' }, lojaQueSai: true, contaQueSai: true },
    { id: vendedorA2, papel: 'vendedor', cargo: null, lojaQueSai: false, contaQueSai: true },
    { id: vendedorB, papel: 'vendedor', cargo: null, lojaQueSai: false, contaQueSai: false },
  )
})

after(async () => {
  const idsDasChaves = await execRows(sql`select id from api_chaves where hash = any(${sql.param(hashes)}::text[])`)
  const chaveIds = idsDasChaves.map(l => l.id as string)
  if (chaveIds.length > 0) {
    await db.execute(sql`delete from api_acessos where chave_id = any(${sql.param(chaveIds)}::uuid[])`)
    await db.execute(sql`delete from api_limite where chave_id = any(${sql.param(chaveIds)}::uuid[])`)
  }
  await db.execute(sql`delete from api_acessos where user_agent = any(${sql.param(uas)}::text[])`)
  await db.execute(sql`delete from api_chaves where hash = any(${sql.param(hashes)}::text[])`)
  await db.execute(sql`delete from usuarios_dados where usuario_id = any(${sql.param(pessoaIds)}::uuid[])`)
  await db.execute(sql`delete from usuarios where id = any(${sql.param(pessoaIds)}::uuid[])`)
  await db.execute(sql`delete from usuarios where id::text like '00000324-%'`)
  await db.execute(sql`delete from cargos where conta_id = any(${sql.param(contaIds)}::uuid[])`)
  for (const [i, contaId] of contaIds.entries()) {
    await apagarContasSemeadas(db, { contaIds: [contaId], prefixo: prefixos[i] })
  }
  await (globalThis as { __pgPool?: { end(): Promise<void> } }).__pgPool?.end()
})

test('caminho feliz: vendedor e mecânico que saiu da loja marcada, com função, loja e ativo', async () => {
  const { pessoas } = await todasAsPaginas()
  const achada = (id: string) => pessoas.find(p => p.id === id)
  assert.deepEqual(achada(vendedorAtivo), {
    id: vendedorAtivo, nome: 'Vendedora Sintética 324', funcao: 'vendedor', loja: { id: A1, nome: 'Loja 324 A1' }, ativo: true,
  })
  assert.deepEqual(achada(mecanicoSaiu), {
    id: mecanicoSaiu, nome: 'Mecânico Sintético Saiu 324', funcao: 'mecanico', loja: { id: A1, nome: 'Loja 324 A1' }, ativo: false,
  })
})

test('colunas exatas: cada pessoa tem só id, nome, função, loja (id e nome, ou nula para sócio) e ativo', async () => {
  const { pessoas } = await todasAsPaginas()
  const minhas = pessoas.filter(p => pessoaIds.includes(p.id))
  assert.ok(minhas.length > 5)
  for (const p of minhas) {
    assert.deepEqual(Object.keys(p).sort(), ['ativo', 'funcao', 'id', 'loja', 'nome'])
    if (p.loja !== null) assert.deepEqual(Object.keys(p.loja).sort(), ['id', 'nome'])
  }
})

test('nenhum texto único de e-mail, CPF ou chave PIX sai em nenhuma página', async () => {
  const { textos } = await todasAsPaginas()
  const tudo = textos.join('\n')
  for (const email of EMAILS_DA_MARCA) assert.equal(tudo.includes(email), false, 'e-mail de funcionário apareceu na resposta')
  assert.equal(tudo.includes(CPF_UNICO), false)
  assert.equal(tudo.includes(PIX_UNICO), false)
})

test('fronteira: loja não marcada da mesma Conta, outra Conta, Conta desativada e grupo inativo não saem', async () => {
  const { pessoas } = await todasAsPaginas()
  const ids = new Set(pessoas.map(p => p.id))
  for (const fora of [vendedorA2, vendedorB, vendedorC, vendedorD]) assert.equal(ids.has(fora), false)
})

test('sócio sai pela Conta com loja que sai, com loja nula; sócio de Conta sem loja marcada não sai', async () => {
  const { pessoas } = await todasAsPaginas()
  const socio = pessoas.find(p => p.id === socioA)
  assert.deepEqual(socio, { id: socioA, nome: 'Sócio Sintético 324', funcao: 'admin_socio', loja: null, ativo: true })
  assert.equal(pessoas.some(p => p.id === socioB), false)
})

test('admin_geral sem loja nem Conta não aparece', async () => {
  const { pessoas } = await todasAsPaginas()
  assert.equal(pessoas.some(p => p.id === adminGeralSemLoja), false)
})

test('cargo vale o papel base: mecânico entra com função mecanico; cargo de sócio entra com função admin_socio e loja nula', async () => {
  const { pessoas } = await todasAsPaginas()
  const achada = (id: string) => pessoas.find(p => p.id === id)
  assert.equal(achada(cargoMecanico)?.funcao, 'mecanico')
  assert.equal(achada(cargoSocio)?.funcao, 'admin_socio')
  assert.equal(achada(cargoSocio)?.loja, null)
})

test('papel extra não duplica a pessoa: uma linha, com a função principal', async () => {
  const { pessoas } = await todasAsPaginas()
  const linhas = pessoas.filter(p => p.id === papelExtra)
  assert.equal(linhas.length, 1)
  assert.equal(linhas[0].funcao, 'aux_adm')
})

test('o SQL e a regra pura dizem a mesma coisa para cada usuário candidato', async () => {
  const { pessoas } = await todasAsPaginas()
  const ids = new Set(pessoas.map(p => p.id))
  for (const c of candidatos) {
    const esperado = ehPessoaQueSai({ papel: c.papel, cargo: c.cargo, lojaQueSai: c.lojaQueSai, contaQueSai: c.contaQueSai })
    assert.equal(ids.has(c.id), esperado, `candidato ${c.papel} (cargo ${c.cargo?.papelBase ?? '-'}, conta ${c.contaQueSai})`)
  }
})

test('ordem por id: a lista vai em ordem crescente de id, mesmo com o de maior id inserido primeiro', async () => {
  const { pessoas } = await todasAsPaginas()
  const ids = pessoas.map(p => p.id)
  for (let i = 1; i < ids.length; i++) assert.ok(ids[i - 1] < ids[i], `fora de ordem: ${ids[i - 1]} antes de ${ids[i]}`)
  const posicao = (id: string) => ids.indexOf(id)
  assert.ok(posicao(f1) < posicao(f2) && posicao(f2) < posicao(f3))
})

test('paginação por id: 501 pessoas saem em páginas de até 500, sem repetição nem perda', async () => {
  const lote = sql`insert into usuarios (id, nome, email, papel, loja_id, conta_id, ativo)
    select ('00000324-0000-4000-8000-' || lpad(g::text, 12, '0'))::uuid, 'Lote 324 ' || g,
      'lote-pe324a-' || g || '@teste.invalid', 'vendedor'::papel, ${A1}::uuid, ${A.contaId}::uuid, true
    from generate_series(1, 501) g`
  await execRows(lote)
  const doLote = new Set(Array.from({ length: 501 }, (_, i) => `00000324-0000-4000-8000-${String(i + 1).padStart(12, '0')}`))

  let cursor: string | null = null
  const vistos: string[] = []
  for (let guarda = 0; guarda < 200; guarda++) {
    const r = await chamar(cursor === null ? '' : `?cursor=${encodeURIComponent(cursor)}`)
    assert.equal(r.status, 200, r.texto)
    const pagina = r.corpo.pessoas ?? []
    assert.ok(pagina.length <= 500, 'página com mais de 500')
    vistos.push(...pagina.map(p => p.id))
    if (!r.corpo.proximaPagina) break
    cursor = r.corpo.proximaPagina
  }
  assert.equal(new Set(vistos).size, vistos.length, 'id repetido entre páginas')
  assert.equal(vistos.filter(id => doLote.has(id)).length, 501)
})

test('cursor forjado (texto que não é base64, outro conjunto, id que não é UUID) dá 400 com a mesma frase', async () => {
  const base64 = (valor: unknown) => Buffer.from(JSON.stringify(valor)).toString('base64url')
  for (const cursor of ['não-é-base64!', base64({ d: '2026-01-01T00:00:00.000Z', n: 1 }), base64({ i: 'não-uuid' })]) {
    const r = await chamar(`?cursor=${encodeURIComponent(cursor)}`)
    assert.equal(r.status, 400)
    assert.deepEqual(r.corpo, { codigo: 'parametro_invalido', frase: 'Parâmetro inválido.' })
  }
})

test('parâmetro de loja, grupo ou Conta na URL não amplia o que sai', async () => {
  const comParametros = await chamar(`?lojaId=${B2}&grupoId=${B.grupoId}&contaId=${B.contaId}`)
  assert.equal(comParametros.status, 200)
  const ids = new Set((comParametros.corpo.pessoas ?? []).map(p => p.id))
  assert.equal(ids.has(vendedorB), false)
  assert.equal(ids.has(vendedorA2), false)
  assert.equal(ids.has(socioB), false)
})

test('sem chave: 401 com a mesma resposta; com chave: a chamada fica no registro de acesso', async () => {
  const semChave = await chamar('', null)
  assert.equal(semChave.status, 401)
  assert.deepEqual(semChave.corpo, { codigo: 'acesso_negado', frase: 'Acesso negado.' })

  const comChave = await chamar('')
  assert.equal(comChave.status, 200)
  await esperarRegistros()
  const registros = await execRows(sql`select endpoint, status from api_acessos where user_agent = ${comChave.ua}`)
  assert.deepEqual(registros.map(r => ({ endpoint: r.endpoint, status: r.status })), [{ endpoint: ENDPOINT, status: 200 }])
})
