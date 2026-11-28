// Teste de banco: GET /api/v1/despesas (#326) chamado com um Request, no banco do test:db. Dados gravados de verdade e
// apagados no after. Os arquivos do test:db rodam em paralelo no mesmo banco: cada conferência filtra pelos ids e pelos
// CNPJs deste teste, e os meses usados são de 2026 e de 2031.
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { inArray, sql } from 'drizzle-orm'
import { NextRequest } from 'next/server'
import { apagarContasSemeadas, semearUsuario } from '@/test/semear-conta'
import { mockAfterDaResposta } from '@/test/after-resposta'
import { semearChaveDaApi, semearContaDaApi, semearLojaDaApi } from '@/test/api-leitura-semear'

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
let execRows: Db['execRows']
let apiAcessos: Schema['apiAcessos']
let apiLimite: Schema['apiLimite']
let apiChaves: Schema['apiChaves']
let despesas: Schema['despesas']
let lancamentosCaixa: Schema['lancamentosCaixa']
let esperarRegistros: () => Promise<void>
let GET: Rota['GET']

const ENDPOINT = '/api/v1/despesas'
const TOKEN = `chave-ds326-${randomUUID()}`
const contaIds: string[] = []
const prefixos: string[] = []
const lojaIds: string[] = []
const uas: string[] = []
let chaveId = ''

type Linha = { ano: number; mes: number; loja: { id: string; nome: string } | null; cnpj: string | null; grupoDre: string; categoria: string; valor: number }
type Corpo = { despesas?: Linha[]; proximaPagina?: string | null; codigo?: string; frase?: string }
const PARAMETRO_INVALIDO = { codigo: 'parametro_invalido', frase: 'Parâmetro inválido.' }
const ACESSO_NEGADO = { codigo: 'acesso_negado', frase: 'Acesso negado.' }

async function chamar(query: string, token: string | null = TOKEN) {
  const ua = `ds326-${randomUUID()}`
  uas.push(ua)
  const headers = new Headers({ 'user-agent': ua, 'x-forwarded-for': '200.3.4.6' })
  if (token !== null) headers.set('authorization', `Bearer ${token}`)
  const resposta = await GET(new NextRequest(`http://localhost${ENDPOINT}${query}`, { headers }))
  const texto = await resposta.text()
  return { status: resposta.status, texto, corpo: JSON.parse(texto) as Corpo, ua }
}

// Contas da semente. A: autorizada, loja A1 marcada, A2 sem marca. B: não autorizada. C: desativada. D: grupo inativo.
// E: autorizada, só loja sem marca (sem empresa geral na API). F: autorizada, com loja marcada e empresa geral.
// CNPJ sintéticos. O do grupo A vem formatado, como o cadastro grava (grupos.cnpj é texto livre); os outros só com dígitos.
const CNPJ = { a: '32.600.000/0001-11', b: '32600000000012', c: '32600000000013', d: '32600000000014', e: '32600000000015', f: '32600000000016', h: '32.600.000/0000-16' }
// Como a resposta devolve o CNPJ: só dígitos.
// A empresa geral sai com o CNPJ como está no cadastro do grupo (decisão do Luis, issue 326).
const CNPJ_SAIDA = { a: CNPJ.a, f: CNPJ.f }
const G = {} as Record<'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'H', { contaId: string; grupoId: string; usuarioId: string }>
const L = { a1: '', a2: '', b1: '', c1: '', d1: '', e1: '', f1: '' }
let idLancadoNoBanco = ''

async function semearConta(letra: 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'H', opcoes: { autorizada?: boolean; desativada?: boolean; grupoInativo?: boolean } = {}) {
  const prefixo = `DS326${letra}`
  const base = await semearContaDaApi(db, { prefixo, cnpj: CNPJ[letra.toLowerCase() as keyof typeof CNPJ], ...opcoes })
  contaIds.push(base.contaId)
  prefixos.push(prefixo)
  lojaIds.push(base.lojaId)
  const usuarioId = await semearUsuario(db, base, { papel: 'aux_adm', rotulo: `usu${letra}`, nomeDoUsuario: 'Usuária Sintética 326', comConta: true })
  G[letra] = { contaId: base.contaId, grupoId: base.grupoId, usuarioId }
}

async function categoria(grupoId: string, nome: string, grupoDre: string | null, contaComoDespesa = true, motivo: string | null = null) {
  await db.execute(sql`insert into categorias_despesa (grupo_id, nome, grupo_dre, conta_como_despesa, motivo_nao_operacional)
    values (${grupoId}, ${nome}, ${grupoDre}, ${contaComoDespesa}, ${motivo})`)
}

async function lancar(letra: keyof typeof G, o: { lojaId: string | null; categoria: string; valor: number; data: string; descricao?: string; beneficiario?: string }) {
  const [linha] = await db.insert(despesas).values({
    grupoId: G[letra].grupoId, lojaId: o.lojaId, usuarioId: G[letra].usuarioId, categoria: o.categoria,
    beneficiario: o.beneficiario ?? null, descricao: o.descricao ?? null, valor: String(o.valor), data: o.data,
    formaPagamento: 'PIX', banco: 'Banco Sintético 326',
  }).returning({ id: despesas.id })
  return linha.id
}

before(async () => {
  ;({ esperarRegistros } = await mockAfterDaResposta())
  ;({ db, execRows } = await import('@/lib/db'))
  ;({ apiAcessos, apiLimite, apiChaves, despesas, lancamentosCaixa } = await import('@/lib/db/schema'))
  ;({ GET } = await import('./route'))
  chaveId = (await semearChaveDaApi(db, TOKEN)).id

  await semearConta('A', { autorizada: true })
  await semearConta('B', { autorizada: false })
  await semearConta('C', { autorizada: true, desativada: true })
  await semearConta('D', { autorizada: true, grupoInativo: true })
  await semearConta('E', { autorizada: true })
  await semearConta('F', { autorizada: true })

  L.a1 = await semearLojaDaApi(db, G.A.grupoId, 'Loja Sintética 326 A1', { marcada: true })
  L.a2 = await semearLojaDaApi(db, G.A.grupoId, 'Loja Sintética 326 A2 sem marca')
  L.b1 = await semearLojaDaApi(db, G.B.grupoId, 'Loja Sintética 326 B1', { marcada: true })
  L.c1 = await semearLojaDaApi(db, G.C.grupoId, 'Loja Sintética 326 C1', { marcada: true })
  L.d1 = await semearLojaDaApi(db, G.D.grupoId, 'Loja Sintética 326 D1', { marcada: true })
  L.e1 = await semearLojaDaApi(db, G.E.grupoId, 'Loja Sintética 326 E1 sem marca')
  L.f1 = await semearLojaDaApi(db, G.F.grupoId, 'Loja Sintética 326 F1', { marcada: true })
  lojaIds.push(L.a1, L.a2, L.b1, L.c1, L.d1, L.e1, L.f1)

  // Catálogo do grupo A: retirada fica fora do cálculo; Luz e Aluguel no grupo do DRE 'ocupacao'.
  await categoria(G.A.grupoId, 'Luz DS326', 'ocupacao')
  await categoria(G.A.grupoId, 'Aluguel DS326', 'ocupacao')
  await categoria(G.A.grupoId, 'Retirada DS326', null, false, 'retirada_socio')
  await categoria(G.A.grupoId, 'Seguro DS326', 'comerciais')

  await lancar('A', { lojaId: L.a1, categoria: 'Luz DS326', valor: 100, data: '2026-01-10' })
  await lancar('A', { lojaId: L.a1, categoria: 'Luz DS326', valor: 50.25, data: '2026-02-05', descricao: 'DESCRICAO_UNICA_326', beneficiario: 'BENEF_UNICO_326' })
  await lancar('A', { lojaId: L.a1, categoria: 'Aluguel DS326', valor: 1000, data: '2026-02-05' })
  await lancar('A', { lojaId: L.a1, categoria: 'Retirada DS326', valor: 700, data: '2026-02-20' })
  await lancar('A', { lojaId: L.a2, categoria: 'Luz DS326', valor: 999, data: '2026-02-05' })
  await lancar('A', { lojaId: null, categoria: 'Seguro DS326', valor: 300, data: '2026-02-15' })
  // Despesa que já veio do banco: conta uma vez (a linha do banco vale, a manual sai pelo vínculo).
  const manualAgua = await lancar('A', { lojaId: L.a1, categoria: 'Água DS326', valor: 80, data: '2026-02-12' })
  await lancar('B', { lojaId: L.b1, categoria: 'Luz DS326', valor: 500, data: '2026-02-05' })
  await lancar('C', { lojaId: L.c1, categoria: 'Luz DS326', valor: 510, data: '2026-02-05' })
  await lancar('D', { lojaId: L.d1, categoria: 'Luz DS326', valor: 520, data: '2026-02-05' })
  await lancar('E', { lojaId: L.e1, categoria: 'Luz DS326', valor: 530, data: '2026-02-05' })
  await lancar('F', { lojaId: null, categoria: 'Seguro DS326', valor: 150, data: '2026-02-15' })
  await lancar('F', { lojaId: L.f1, categoria: 'Luz DS326', valor: 60, data: '2026-02-05' })

  idLancadoNoBanco = manualAgua
  await db.execute(sql`insert into despesas_open_finance (grupo_id, conta_id, banco, transacao_id, data, valor, categoria, loja_id, despesa_id)
    values (${G.A.grupoId}, 'conta-ds326', 'Banco DS326', ${`tx-ds326-agua-${randomUUID()}`}, '2026-02-12T12:00:00Z', 80, 'Água DS326', ${L.a1}, ${manualAgua})`)
  // Lançado às 23:30 de Brasília de 28/02 (02:30 UTC de 01/03): o mês é fevereiro.
  await db.execute(sql`insert into despesas_open_finance (grupo_id, conta_id, banco, transacao_id, data, valor, categoria, loja_id)
    values (${G.A.grupoId}, 'conta-ds326', 'Banco DS326', ${`tx-ds326-virada-${randomUUID()}`}, '2026-03-01T02:30:00Z', 40, 'Luz DS326', ${L.a1})`)
})

after(async () => {
  await db.execute(sql`delete from despesas_open_finance where grupo_id = any(${sql.param(Object.values(G).map(g => g.grupoId))}::uuid[])`)
  await db.delete(apiAcessos).where(inArray(apiAcessos.userAgent, uas))
  await db.delete(apiAcessos).where(sql`chave_id = ${chaveId}`)
  await db.delete(apiLimite).where(sql`chave_id = ${chaveId}`)
  await db.delete(apiChaves).where(sql`id = ${chaveId}`)
  if (Object.keys(G).length > 0) {
    await db.delete(despesas).where(inArray(despesas.grupoId, [...Object.values(G), ...extras].map(g => g.grupoId)))
  await db.execute(sql`delete from lancamentos_caixa where usuario_id in (select id from usuarios where email like '%-ds326%-%')`)
  }
  for (const [i, contaId] of contaIds.entries()) {
    await apagarContasSemeadas(db, { contaIds: [contaId], prefixo: prefixos[i] })
  }
  await (globalThis as { __pgPool?: { end(): Promise<void> } }).__pgPool?.end()
})

// Grupos extras deste arquivo: CNPJ com pontuação, vazio, curto e com letra, e repetido entre grupos.
type Grupo = { contaId: string; grupoId: string; lojaId: string; usuarioId: string }
const extras: Grupo[] = []
async function grupoExtra(rotulo: string, cnpj: string, { autorizada = true, marcada = true }: { autorizada?: boolean; marcada?: boolean } = {}): Promise<Grupo> {
  const prefixo = `DS326${rotulo}`
  const base = await semearContaDaApi(db, { prefixo, cnpj, autorizada })
  contaIds.push(base.contaId)
  prefixos.push(prefixo)
  const lojaId = await semearLojaDaApi(db, base.grupoId, `Loja Sintética 326 ${rotulo}`, { marcada })
  lojaIds.push(lojaId)
  const usuarioId = await semearUsuario(db, base, { papel: 'aux_adm', rotulo: `usu${rotulo}`, nomeDoUsuario: 'Usuária Sintética 326', comConta: true })
  const g = { contaId: base.contaId, grupoId: base.grupoId, lojaId, usuarioId }
  extras.push(g)
  return g
}
async function lancarNoGrupo(g: Grupo, o: { lojaId: string | null; categoria: string; valor: number; data: string }) {
  await db.insert(despesas).values({
    grupoId: g.grupoId, lojaId: o.lojaId, usuarioId: g.usuarioId, categoria: o.categoria, valor: String(o.valor), data: o.data,
    formaPagamento: 'PIX', banco: 'Banco Sintético 326',
  })
}

const deNossas = (linhas: Linha[] = []) => linhas.filter(l => l.loja?.id === L.a1 || l.cnpj === CNPJ_SAIDA.a)
const chaveDaLinha = (l: Linha) => `${l.ano}-${String(l.mes).padStart(2, '0')}|${l.loja ? l.loja.id : `geral:${l.cnpj}`}|${l.categoria}|${l.valor}`

test('chave válida: sai a despesa somada por mês, loja e categoria, com o grupo do DRE e a empresa geral por CNPJ', async () => {
  const { status, corpo } = await chamar('?de=2026-01&ate=2026-02')
  assert.equal(status, 200)
  assert.deepEqual(deNossas(corpo.despesas).map(chaveDaLinha).sort(), [
    `2026-01|${L.a1}|Luz DS326|100`,
    `2026-02|${L.a1}|Aluguel DS326|1000`,
    `2026-02|${L.a1}|Luz DS326|90.25`,
    `2026-02|${L.a1}|Água DS326|80`,
    `2026-02|geral:${CNPJ_SAIDA.a}|Seguro DS326|300`,
  ].sort())
  const luz = deNossas(corpo.despesas).find(l => l.categoria === 'Luz DS326' && l.mes === 2)
  assert.equal(luz?.grupoDre, 'ocupacao')
  assert.equal(deNossas(corpo.despesas).find(l => l.categoria === 'Seguro DS326')?.grupoDre, 'comerciais')
  for (const linha of corpo.despesas ?? []) assert.deepEqual(Object.keys(linha).sort(), ['ano', 'categoria', 'cnpj', 'grupoDre', 'loja', 'mes', 'valor'])
})

test('lançamento individual, descrição, beneficiário, banco e id interno não aparecem na resposta', async () => {
  const { texto } = await chamar('?de=2026-01&ate=2026-02')
  for (const proibido of ['DESCRICAO_UNICA_326', 'BENEF_UNICO_326', 'Banco DS326', 'Usuária Sintética 326', idLancadoNoBanco]) {
    assert.ok(!texto.includes(proibido), proibido)
  }
})

test('loja marcada de Conta não autorizada, desmarcada, de Conta desativada e de grupo inativo não saem', async () => {
  const { texto } = await chamar('?de=2026-01&ate=2026-02')
  for (const id of [L.b1, L.c1, L.d1, CNPJ.b, CNPJ.c, CNPJ.d, L.a2, L.e1]) assert.ok(!texto.includes(id), id)
})

test('retirada (categoria fora do cálculo) não entra na soma; a loja não marcada não entra', async () => {
  const { corpo } = await chamar('?de=2026-02&ate=2026-02')
  assert.ok(!deNossas(corpo.despesas).some(l => l.categoria === 'Retirada DS326'))
  assert.ok(!(corpo.despesas ?? []).some(l => l.valor === 999 || l.valor === 700))
})

test('despesa que já veio do banco conta uma vez, e a manual vinculada não conta de novo', async () => {
  const { corpo } = await chamar('?de=2026-02&ate=2026-02')
  const agua = (corpo.despesas ?? []).filter(l => l.categoria === 'Água DS326')
  assert.deepEqual(agua.map(l => l.valor), [80])
})

test('empresa geral sai por CNPJ com loja marcada; CNPJ sem loja marcada não aparece', async () => {
  const { corpo, texto } = await chamar('?de=2026-02&ate=2026-02')
  const geraisA = (corpo.despesas ?? []).filter(l => l.loja === null && l.cnpj === CNPJ_SAIDA.a)
  assert.deepEqual(geraisA.map(l => [l.categoria, l.valor]), [['Seguro DS326', 300]])
  assert.ok(!texto.includes(CNPJ.e))
  const geraisF = (corpo.despesas ?? []).filter(l => l.loja === null && l.cnpj === CNPJ_SAIDA.f)
  assert.deepEqual(geraisF.map(l => [l.categoria, l.valor]), [['Seguro DS326', 150]])
})

// Mesmo SQL do total do banco, com a retirada pelo nome da categoria. Prova a regra de não somar duas vezes e de tirar
// o que não é a loja; não prova a exclusão por descrição (isso é do teste de fontes de julho de 2033).
test('soma das linhas bate com o total do banco, com a regra de não somar duas vezes e a retirada pelo nome', async () => {
  const { corpo } = await chamar('?de=2026-02&ate=2026-02')
  const somaDaResposta = deNossas(corpo.despesas).reduce((s, l) => s + l.valor, 0)
  const [linha] = await execRows(sql`
    select coalesce(sum(valor), 0)::float8 as total from (
      select d.valor from despesas d
       where d.grupo_id = ${G.A.grupoId} and d.data >= '2026-02-01' and d.data < '2026-03-01'
         and (d.loja_id is null or d.loja_id = any(${sql.param([L.a1])}::uuid[]))
         and d.categoria <> 'Retirada DS326'
         and not exists (select 1 from despesas_open_finance o where o.despesa_id = d.id)
      union all
      select o.valor from despesas_open_finance o
       where o.grupo_id = ${G.A.grupoId} and o.data >= '2026-02-01T03:00:00Z' and o.data < '2026-03-01T03:00:00Z'
         and (o.loja_id is null or o.loja_id = any(${sql.param([L.a1])}::uuid[]))
    ) t`) as { total: number }[]
  assert.equal(somaDaResposta, Number(linha.total))
  assert.equal(somaDaResposta, 1470.25)
})

test('mês em Brasília: o lançamento de 28/02 às 23:30 (01/03 02:30 UTC) sai em fevereiro, não em março', async () => {
  const fev = await chamar('?de=2026-02&ate=2026-02')
  assert.ok(deNossas(fev.corpo.despesas).some(l => l.categoria === 'Luz DS326' && l.mes === 2 && l.valor === 90.25))
  const mar = await chamar('?de=2026-03&ate=2026-03')
  assert.ok(!deNossas(mar.corpo.despesas).some(l => l.mes === 3))
})

test('período fora da regra: 400 com a lista fixa, sem eco', async () => {
  for (const query of ['?de=2025-12&ate=2026-02', '?de=2026-02&ate=2026-01', '?de=2026-01&ate=2027-02', '?de=2026-13&ate=2026-14', '?ate=2026-02']) {
    const { status, corpo } = await chamar(query)
    assert.equal(status, 400, query)
    assert.deepEqual(corpo, PARAMETRO_INVALIDO, query)
  }
})

test('sem chave: acesso negado, sem dado, e chamada registrada', async () => {
  const { status, corpo, texto } = await chamar('?de=2026-01&ate=2026-02', null)
  assert.equal(status, 401)
  assert.deepEqual(corpo, ACESSO_NEGADO)
  assert.ok(!texto.includes(L.a1))
})

test('cursor adulterado, ou de mês fora do período, é recusado com 400', async () => {
  const lixo = await chamar('?de=2026-01&ate=2026-02&cursor=lixo')
  assert.equal(lixo.status, 400)
  const outro = Buffer.from(JSON.stringify({ a: 2031, m: 5, t: 0, k: L.a1, c: 'Luz DS326' })).toString('base64url')
  const fora = await chamar(`?de=2026-01&ate=2026-02&cursor=${outro}`)
  assert.equal(fora.status, 400)
  assert.deepEqual(fora.corpo, PARAMETRO_INVALIDO)
})

test('página de 500 com a virada na empresa geral: 503 linhas de 2031, sem repetição nem perda', async () => {
  const lojaValores = Array.from({ length: 498 }, (_, i) => ({
    grupoId: G.A.grupoId, lojaId: L.a1, usuarioId: G.A.usuarioId, categoria: `Cat326 ${String(i).padStart(3, '0')}`,
    valor: '1', data: '2031-05-10', formaPagamento: 'PIX', banco: 'Banco Sintético 326',
  }))
  const geraisValores = Array.from({ length: 5 }, (_, i) => ({
    grupoId: G.A.grupoId, lojaId: null, usuarioId: G.A.usuarioId, categoria: `Geral326 ${i + 1}`,
    valor: '2', data: '2031-05-10', formaPagamento: 'PIX', banco: 'Banco Sintético 326',
  }))
  await db.insert(despesas).values([...lojaValores, ...geraisValores])
  const primeira = await chamar('?de=2031-05&ate=2031-05')
  assert.equal(primeira.status, 200)
  assert.equal(primeira.corpo.despesas?.length, 500)
  assert.ok(primeira.corpo.proximaPagina)
  const segunda = await chamar(`?de=2031-05&ate=2031-05&cursor=${primeira.corpo.proximaPagina}`)
  assert.equal(segunda.status, 200)
  assert.equal(segunda.corpo.proximaPagina, null)
  const todas = [...(primeira.corpo.despesas ?? []), ...(segunda.corpo.despesas ?? [])]
  assert.equal(todas.length, 503)
  assert.equal(new Set(todas.map(chaveDaLinha)).size, 503)
  assert.deepEqual((primeira.corpo.despesas ?? []).slice(-2).map(l => l.loja), [null, null])
  assert.deepEqual((segunda.corpo.despesas ?? []).map(l => l.categoria), ['Geral326 3', 'Geral326 4', 'Geral326 5'])
})

test('registro de acesso: uma linha por chamada, com o período de primeiro a último dia', async () => {
  const ok = await chamar('?de=2026-01&ate=2026-02')
  await esperarRegistros()
  const linhas = await execRows(sql`
    select endpoint, status, chave_id, to_char(periodo_ini, 'YYYY-MM-DD') as ini, to_char(periodo_fim, 'YYYY-MM-DD') as fim
      from api_acessos where user_agent = ${ok.ua}`) as { endpoint: string; status: number; chave_id: string; ini: string; fim: string }[]
  assert.deepEqual(linhas, [{ endpoint: ENDPOINT, status: 200, chave_id: chaveId, ini: '2026-01-01', fim: '2026-02-28' }])
})

test('desmarcar a loja: as despesas dela somem na consulta seguinte', async () => {
  const antes = await chamar('?de=2026-02&ate=2026-02')
  assert.ok(deNossas(antes.corpo.despesas).some(l => l.loja?.id === L.a1))
  await db.execute(sql`update lojas set loja_motochefe = false where id = ${L.a1}`)
  const depois = await chamar('?de=2026-02&ate=2026-02')
  assert.ok(!depois.texto.includes(L.a1))
})

test('fontes do banco e do caixa: só as lojas que saem entram; retirada pela descrição do banco fica de fora', async () => {
  // Roda depois de 'desmarcar a loja' (que desmarca A1): marca de novo, para este teste ter a loja A1 de volta.
  await db.execute(sql`update lojas set loja_motochefe = true where id = ${L.a1}`)
  await db.execute(sql`insert into despesas_open_finance (grupo_id, conta_id, banco, transacao_id, data, valor, categoria, loja_id)
    values (${G.A.grupoId}, 'conta-ds326', 'Banco DS326', ${`tx-ds326-a1-${randomUUID()}`}, '2033-07-10T12:00:00Z', 33, 'Banco A1 DS326', ${L.a1}),
           (${G.A.grupoId}, 'conta-ds326', 'Banco DS326', ${`tx-ds326-a2-${randomUUID()}`}, '2033-07-10T12:00:00Z', 999, 'Banco A2 DS326', ${L.a2}),
           (${G.A.grupoId}, 'conta-ds326', 'Banco DS326', ${`tx-ds326-ret-${randomUUID()}`}, '2033-07-12T12:00:00Z', 555, 'Banco ret DS326', ${L.a1})`)
  await db.execute(sql`update despesas_open_finance set descricao = 'Retirada DS326 julho' where categoria = 'Banco ret DS326'`)
  await db.insert(lancamentosCaixa).values([
    { lojaId: L.a1, usuarioId: G.A.usuarioId, tipo: 'saida', categoria: 'Aluguel Caixa DS326', valor: '22', data: '2033-07-11' },
    { lojaId: L.a2, usuarioId: G.A.usuarioId, tipo: 'saida', categoria: 'Caixa A2 DS326', valor: '888', data: '2033-07-11' },
  ])
  const { status, corpo } = await chamar('?de=2033-07&ate=2033-07')
  assert.equal(status, 200)
  const ours = (corpo.despesas ?? []).filter(l => l.loja?.id === L.a1 || l.loja?.id === L.a2 || l.cnpj === CNPJ_SAIDA.a)
  // Ordem exata, sem sort: o somarDespesas põe as categorias do maior valor para o menor (Banco 33 antes de Aluguel 22),
  // e a ordem por nome (Aluguel antes de Banco) é a da página: sem a ordenação, o teste falha.
  assert.deepEqual(ours.map(chaveDaLinha), [
    `2033-07|${L.a1}|Aluguel Caixa DS326|22`,
    `2033-07|${L.a1}|Banco A1 DS326|33`,
  ])
  assert.ok(!(corpo.despesas ?? []).some(l => [999, 888, 555].includes(l.valor)))
})

test('página seguinte que começa num mês: o mês anterior, já paginado, não se perde nem se repete', async () => {
  await lancar('A', { lojaId: L.a1, categoria: 'Abr326 DS326', valor: 7, data: '2031-04-10' })
  // Lançamento de banco em maio: o cálculo lê o banco primeiro, então maio entra antes de abril sem a ordenação.
  await db.execute(sql`insert into despesas_open_finance (grupo_id, conta_id, banco, transacao_id, data, valor, categoria, loja_id)
    values (${G.A.grupoId}, 'conta-ds326', 'Banco DS326', ${`tx-ds326-mai-${randomUUID()}`}, '2031-05-02T12:00:00Z', 1, 'Banco Mai326 DS326', ${L.a1})`)
  const primeira = await chamar('?de=2031-04&ate=2031-05')
  assert.equal(primeira.status, 200)
  const nossas = (primeira.corpo.despesas ?? []).filter(l => l.loja?.id === L.a1)
  assert.equal(nossas[0].categoria, 'Abr326 DS326')
  assert.ok(primeira.corpo.proximaPagina)
  const segunda = await chamar(`?de=2031-04&ate=2031-05&cursor=${primeira.corpo.proximaPagina}`)
  assert.equal(segunda.status, 200)
  const todas = [...(primeira.corpo.despesas ?? []), ...(segunda.corpo.despesas ?? [])].filter(l => l.loja?.id === L.a1 || l.cnpj === CNPJ_SAIDA.a)
  // 500 de loja (498 de maio da carga, 1 do banco de maio, 1 de abril) e 5 da empresa geral de maio: 505, sem repetir nem perder.
  assert.equal(todas.length, 505)
  assert.equal(new Set(todas.map(chaveDaLinha)).size, todas.length)
})

test('categoria que só existe no catálogo de outra Conta: a despesa sai com o grupo do DRE "outras", nunca com a classificação de outra Conta', async () => {
  // A categoria está no catálogo da Conta F (com grupo do DRE 'pessoal'), mas a Conta A não a cadastrou.
  await categoria(G.F.grupoId, 'Categoria Outra Conta DS326', 'pessoal')
  await lancar('A', { lojaId: L.a1, categoria: 'Categoria Outra Conta DS326', valor: 61, data: '2034-03-05' })
  const { status, corpo } = await chamar('?de=2034-03&ate=2034-03')
  assert.equal(status, 200)
  const nossas = (corpo.despesas ?? []).filter(l => l.loja?.id === L.a1)
  assert.deepEqual(nossas.map(l => [l.categoria, l.grupoDre, l.valor]), [['Categoria Outra Conta DS326', 'outras', 61]])
})

test('dois grupos autorizados com o mesmo CNPJ: uma linha por grupo, cada uma com o seu valor e o seu grupo do DRE', async () => {
  const y = await grupoExtra('Y', '32.600.000/0002-22')
  const z = await grupoExtra('Z', '32.600.000/0002-22')
  await categoria(y.grupoId, 'Seguro Mesmo326', 'comerciais')
  await categoria(z.grupoId, 'Seguro Mesmo326', 'pessoal')
  await lancarNoGrupo(y, { lojaId: null, categoria: 'Seguro Mesmo326', valor: 150, data: '2040-03-10' })
  await lancarNoGrupo(z, { lojaId: null, categoria: 'Seguro Mesmo326', valor: 40, data: '2040-03-10' })
  const { status, corpo } = await chamar('?de=2040-03&ate=2040-03')
  assert.equal(status, 200)
  const gerais = (corpo.despesas ?? []).filter(l => l.loja === null && l.cnpj === '32.600.000/0002-22')
  assert.deepEqual(gerais.map(l => [l.categoria, l.grupoDre, l.valor]).sort(), [
    ['Seguro Mesmo326', 'comerciais', 150],
    ['Seguro Mesmo326', 'pessoal', 40],
  ])
})

test('mesmo CNPJ numa Conta não autorizada ou num grupo sem loja marcada: não entra', async () => {
  const q = await grupoExtra('Q', '32.600.000/0002-22', { autorizada: false })
  const r = await grupoExtra('R', '32.600.000/0002-22', { marcada: false })
  await lancarNoGrupo(q, { lojaId: null, categoria: 'Seguro Mesmo326', valor: 999, data: '2040-03-10' })
  await lancarNoGrupo(r, { lojaId: null, categoria: 'Seguro Mesmo326', valor: 777, data: '2040-03-10' })
  const { corpo, texto } = await chamar('?de=2040-03&ate=2040-03')
  const gerais = (corpo.despesas ?? []).filter(l => l.loja === null && l.cnpj === '32.600.000/0002-22')
  assert.deepEqual(gerais.map(l => l.valor).sort((a, b) => a - b), [40, 150])
  assert.ok(!texto.includes(q.grupoId) && !texto.includes(r.grupoId))
})

// Virada de página exatamente numa linha de empresa geral, com CNPJ vazio, curto e com letra. 498 linhas de loja
// mais 3 gerais: a 500ª linha é a 2ª geral; a página seguinte começa na 3ª.
const FORMAS_DE_CNPJ: [string, string, string][] = [
  ['vazio', '', '2041-05'],
  ['curto', '326', '2042-05'],
  ['com letra', 'AB-12', '2043-05'],
]
for (const [nome, cnpj, mes] of FORMAS_DE_CNPJ) {
  test(`CNPJ ${nome}: a linha da empresa geral sai e a página seguinte funciona na virada exatamente nela`, async () => {
    const g = await grupoExtra(`V${mes.replace('-', '')}`, cnpj)
    await db.insert(despesas).values([
      ...Array.from({ length: 498 }, (_, i) => ({
        grupoId: G.A.grupoId, lojaId: L.a1, usuarioId: G.A.usuarioId, categoria: `Cat${mes} ${String(i).padStart(3, '0')}`,
        valor: '1', data: `${mes}-10`, formaPagamento: 'PIX', banco: 'Banco Sintético 326',
      })),
      ...['Geral 1', 'Geral 2', 'Geral 3'].map(categoriaGeral => ({
        grupoId: g.grupoId, lojaId: null, usuarioId: g.usuarioId, categoria: `${categoriaGeral} ${mes}`,
        valor: '2', data: `${mes}-10`, formaPagamento: 'PIX', banco: 'Banco Sintético 326',
      })),
    ])
    const esperado = cnpj === '' ? null : cnpj
    const primeira = await chamar(`?de=${mes}&ate=${mes}`)
    assert.equal(primeira.status, 200)
    assert.equal(primeira.corpo.despesas?.length, 500)
    const ultima = primeira.corpo.despesas?.at(-1)
    assert.equal(ultima?.loja, null)
    assert.equal(ultima?.cnpj, esperado)
    assert.equal(ultima?.categoria, `Geral 2 ${mes}`)
    assert.ok(primeira.corpo.proximaPagina)
    const segunda = await chamar(`?de=${mes}&ate=${mes}&cursor=${primeira.corpo.proximaPagina}`)
    assert.equal(segunda.status, 200)
    assert.deepEqual((segunda.corpo.despesas ?? []).map(l => [l.loja, l.cnpj, l.categoria]), [[null, esperado, `Geral 3 ${mes}`]])
    assert.equal(segunda.corpo.proximaPagina, null)
  })
}
