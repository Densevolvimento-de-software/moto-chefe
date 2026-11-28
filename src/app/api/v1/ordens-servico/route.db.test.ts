// Teste de banco: GET /api/v1/ordens-servico (#325) chamado com um Request, no banco do test:db.
// Dados gravados de verdade e apagados no after. Os arquivos do test:db rodam em paralelo no mesmo banco:
// cada conferência filtra pelos ids das lojas deste teste, e os dias usados são de março e abril de 2026.
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { NextRequest } from 'next/server'
import { apagarContasSemeadas, semearUsuario } from '@/test/semear-conta'
import { semearChaveDaApi, semearContaDaApi, semearLojaDaApi } from '@/test/api-leitura-semear'
import { mockAfterDaResposta } from '@/test/after-resposta'

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
let apiAcessos: typeof import('@/lib/db/schema')['apiAcessos']
let esperarRegistros: () => Promise<void>
let GET: Rota['GET']

const ENDPOINT = '/api/v1/ordens-servico'
const sha = (texto: string) => createHash('sha256').update(texto).digest('hex')
const CHAVE = `chave-os325-${randomUUID()}`
const hashes: string[] = []
const uas: string[] = []
const uaNovo = () => {
  const ua = `os325-${randomUUID()}`
  uas.push(ua)
  return ua
}
const contaIds: string[] = []
const grupoIds: string[] = []
const lojaIds: string[] = []
const prefixos: string[] = []
const pecaIds: string[] = []

type OS = {
  id: string; numero: number | null; status: string; abertura: string; conclusao: string | null
  loja: { id: string; nome: string }; tecnico: { id: string; nome: string } | null
  chassi: string | null; marca: string | null; modelo: string | null
  itens: { tipo: string; quantidade: number; valorUnitario: number; valor: number }[]; total: number | null
}
type Corpo = { de?: string; ate?: string; ordens?: OS[]; proximaPagina?: string | null; codigo?: string; frase?: string }

async function chamar(query: string, token: string | null = CHAVE) {
  const ua = uaNovo()
  const headers = new Headers({ 'user-agent': ua, 'x-forwarded-for': '200.3.2.5' })
  if (token !== null) headers.set('authorization', `Bearer ${token}`)
  const resposta = await GET(new NextRequest(`http://localhost${ENDPOINT}${query}`, { headers }))
  const texto = await resposta.text()
  return { status: resposta.status, texto, corpo: JSON.parse(texto) as Corpo, ua }
}
const periodo = (de: string, ate: string) => `?de=${de}&ate=${ate}`
const linha = async (q: ReturnType<typeof sql>) => (await execRows(q))[0] as { id: string }

// Só as OS das lojas deste teste: o endpoint devolve as de todas as lojas marcadas, inclusive as de outros testes.
const deste = (ordens: OS[] = []) => ordens.filter(o => lojaIds.includes(o.loja.id))

type Conta = { contaId: string; grupoId: string; lojaBaseId: string; tecnicoId: string; abertaPorId: string; prefixo: string }

async function semearConta(letra: string, cnpj: string, opcoes: { desativada?: boolean; grupoInativo?: boolean } = {}): Promise<Conta> {
  const prefixo = `OS325${letra}`
  const base = await semearContaDaApi(db, { prefixo, cnpj, desativada: opcoes.desativada, grupoInativo: opcoes.grupoInativo })
  contaIds.push(base.contaId)
  grupoIds.push(base.grupoId)
  lojaIds.push(base.lojaId)
  prefixos.push(prefixo)
  const tecnicoId = await semearUsuario(db, base, { papel: 'mecanico', rotulo: `tec${letra}`, nomeDoUsuario: `Técnica Sintética 325 ${letra}`, comConta: true })
  const abertaPorId = await semearUsuario(db, base, { papel: 'aux_adm', rotulo: `abr${letra}`, nomeDoUsuario: `Abertura Sintética 325 ${letra}`, comConta: true })
  return { contaId: base.contaId, grupoId: base.grupoId, lojaBaseId: base.lojaId, tecnicoId, abertaPorId, prefixo }
}

async function semearLoja(c: Conta, nome: string, marcada: boolean): Promise<string> {
  const id = await semearLojaDaApi(db, c.grupoId, nome, { marcada })
  lojaIds.push(id)
  return id
}

async function semearMoto(lojaId: string): Promise<{ motoId: string; chassi: string }> {
  const modelo = await linha(sql`insert into modelos (marca, modelo, categoria, potencia_w, motor, velocidade_max)
    values ('MotoChefe', ${`M325 ${randomUUID()}`}, 'autopropelido', '1000', 'hub', '32') returning id`)
  const chassi = `CHASSI-ESTOQUE-325-${randomUUID()}`
  const moto = await linha(sql`insert into motos (chassi, modelo_id, loja_id, cor, nota_fiscal_entrada, status, disponibilidade)
    values (${chassi}, ${modelo.id}, ${lojaId}, 'PRETO', '1', 'disponivel', 'disponivel') returning id`)
  return { motoId: moto.id, chassi }
}

type OpcoesDaOS = {
  lojaId: string; abertaPor: string; dataAbertura: string; id?: string; numero?: number | null; status?: string
  mecanicoId?: string | null; motoId?: string | null; dataConclusao?: string | null; valorTotal?: number | null
  descricao?: string; diagnostico?: string | null; observacoes?: string | null; placa?: string | null
  clienteNome?: string | null; clienteFone?: string | null; clienteDoc?: string | null
  motivo?: string | null; marcaExterna?: string | null; modeloExterno?: string | null; chassiOs?: string | null
  agendamentoId?: string | null; clienteId?: string | null
}

async function semearOS(o: OpcoesDaOS): Promise<string> {
  const id = o.id ?? randomUUID()
  await db.execute(sql`insert into ordens_servico (id, numero, moto_id, loja_id, aberta_por, mecanico_id, status, descricao,
      diagnostico, observacoes_finais, placa, cliente_nome_externo, cliente_fone_externo, cliente_documento_externo,
      marca_externa, modelo_externo, chassi_os, data_abertura, data_conclusao, motivo_cancelamento, cancelada_em,
      agendamento_id, valor_total, cliente_id)
    values (${id}, ${o.numero ?? null}, ${o.motoId ?? null}, ${o.lojaId}, ${o.abertaPor}, ${o.mecanicoId ?? null},
      ${o.status ?? 'concluida'}, ${o.descricao ?? 'Descrição sintética 325'}, ${o.diagnostico ?? null}, ${o.observacoes ?? null},
      ${o.placa ?? null}, ${o.clienteNome ?? null}, ${o.clienteFone ?? null}, ${o.clienteDoc ?? null},
      ${o.marcaExterna ?? null}, ${o.modeloExterno ?? null}, ${o.chassiOs ?? null}, ${o.dataAbertura}, ${o.dataConclusao ?? null},
      ${o.motivo ?? null}, ${o.motivo ? sql`now()` : null}, ${o.agendamentoId ?? null}, ${o.valorTotal ?? null}, ${o.clienteId ?? null})`)
  return id
}

async function semearItem(osId: string, o: { tipo: string; quantidade: number; valorUnitario: number; descricao?: string; pecaId?: string | null }) {
  await db.execute(sql`insert into os_itens (os_id, tipo, descricao, quantidade, valor_unitario, peca_id)
    values (${osId}, ${o.tipo}, ${o.descricao ?? 'Item sintético 325'}, ${String(o.quantidade)}, ${String(o.valorUnitario)}, ${o.pecaId ?? null})`)
}

// Muitas OS no mesmo instante: a ordem só se decide pelo id, e o corte de página cai no meio do empate.
async function semear501NoMesmoInstante(lojaId: string, abertaPor: string, dataAbertura: string, quantidade = 501) {
  await db.execute(sql`insert into ordens_servico (loja_id, aberta_por, descricao, status, data_abertura)
    select ${lojaId}, ${abertaPor}, 'Em massa sintética 325', 'concluida', ${dataAbertura}::timestamptz
    from generate_series(1, ${quantidade})`)
}

// Dá a cada OS da massa dois ou três itens (conforme o id), para a página ter OS com vários itens.
async function semearItensNasOS(lojaId: string, dataAbertura: string) {
  await db.execute(sql`insert into os_itens (os_id, tipo, descricao, quantidade, valor_unitario)
    select o.id, 'servico', 'Item em massa 325', 1, 10
    from ordens_servico o cross join generate_series(1, 3) g(n)
    where o.loja_id = ${lojaId} and o.data_abertura = ${dataAbertura}::timestamptz and o.descricao = 'Em massa sintética 325'
      and g.n <= 2 + (abs(hashtext(o.id::text)) % 2)`)
}

let A: Conta, B: Conta, C: Conta, D: Conta
let A1: string, A2: string, B1: string, C1: string, D1: string

before(async () => {
  ;({ esperarRegistros } = await mockAfterDaResposta())
  ;({ db, execRows } = await import('@/lib/db'))
  ;({ apiAcessos } = await import('@/lib/db/schema'))
  ;({ GET } = await import('./route'))

  A = await semearConta('A', '32325000000001')
  B = await semearConta('B', '32325000000002')
  C = await semearConta('C', '32325000000003', { desativada: true })
  D = await semearConta('D', '32325000000004', { grupoInativo: true })
  A1 = await semearLoja(A, 'Loja 325 A1', true)
  A2 = await semearLoja(A, 'Loja 325 A2', false)
  B1 = await semearLoja(B, 'Loja 325 B1', true)
  C1 = await semearLoja(C, 'Loja 325 C1', true)
  D1 = await semearLoja(D, 'Loja 325 D1', true)

  hashes.push(sha(CHAVE))
  await semearChaveDaApi(db, CHAVE)
})

after(async () => {
  const chaveIds = (await execRows(sql`select id from api_chaves where hash = any(${sql.param(hashes)}::text[])`)).map(l => l.id as string)
  if (chaveIds.length > 0) {
    await db.delete(apiAcessos).where(sql`chave_id = any(${sql.param(chaveIds)}::uuid[])`)
  }
  await db.delete(apiAcessos).where(sql`user_agent = any(${sql.param(uas)}::text[])`)
  await db.execute(sql`delete from api_limite where chave_id in (select id from api_chaves where hash = any(${sql.param(hashes)}::text[]))`)
  await db.execute(sql`delete from api_chaves where hash = any(${sql.param(hashes)}::text[])`)
  await db.execute(sql`delete from ordens_servico where loja_id = any(${sql.param(lojaIds)}::uuid[])`)
  await db.execute(sql`delete from agendamentos where loja_id = any(${sql.param(lojaIds)}::uuid[])`)
  await db.execute(sql`delete from clientes where conta_id = any(${sql.param(contaIds)}::uuid[])`)
  await db.execute(sql`delete from motos where loja_id = any(${sql.param(lojaIds)}::uuid[])`)
  await db.execute(sql`delete from pecas_catalogo where conta_id = any(${sql.param(contaIds)}::uuid[])`)
  await db.execute(sql`delete from modelos where modelo like 'M325 %'`)
  for (const [i, contaId] of contaIds.entries()) {
    await apagarContasSemeadas(db, { contaIds: [contaId], prefixo: prefixos[i] })
  }
  await (globalThis as { __pgPool?: { end(): Promise<void> } }).__pgPool?.end()
})

test('chave válida: a OS da loja marcada sai com a lista fechada de campos, e o item com a sua', async () => {
  const { motoId, chassi } = await semearMoto(A1)
  const os = await semearOS({ lojaId: A1, abertaPor: A.abertaPorId, mecanicoId: A.tecnicoId, motoId, dataAbertura: '2026-03-20T15:00:00.000Z', numero: 9001 })
  await semearItem(os, { tipo: 'servico', quantidade: 1, valorUnitario: 80 })
  const { status, corpo } = await chamar(periodo('2026-03-20', '2026-03-20'))
  assert.equal(status, 200)
  const saida = deste(corpo.ordens).find(o => o.id === os)
  assert.ok(saida, 'a OS da loja marcada deveria sair')
  assert.deepEqual(Object.keys(saida).sort(), ['abertura', 'chassi', 'conclusao', 'id', 'itens', 'loja', 'marca', 'modelo', 'numero', 'status', 'tecnico', 'total'])
  assert.deepEqual(Object.keys(saida.itens[0]).sort(), ['quantidade', 'tipo', 'valor', 'valorUnitario'])
  assert.equal(saida.numero, 9001)
  assert.equal(saida.chassi, chassi)
  assert.equal(saida.loja.id, A1)
})

test('texto de cliente, placa, descrição, diagnóstico, observações, motivo e descrição livre do item não aparecem na resposta', async () => {
  const textos = ['ClienteSintetico325Nome', '99988877766', '61999998888', 'PLA325X', 'DescricaoSintetica325', 'DiagnosticoSintetico325', 'ObservacaoSintetica325', 'MotivoSintetico325', 'ItemLivreSintetico325']
  const dia = '2026-03-21'
  const os = await semearOS({
    lojaId: A1, abertaPor: A.abertaPorId, dataAbertura: `${dia}T15:00:00.000Z`,
    clienteNome: textos[0], clienteDoc: textos[1], clienteFone: textos[2], placa: textos[3],
    descricao: textos[4], diagnostico: textos[5], observacoes: textos[6],
  })
  await semearItem(os, { tipo: 'peca', quantidade: 1, valorUnitario: 10, descricao: textos[8] })
  await semearOS({ lojaId: A1, abertaPor: A.abertaPorId, dataAbertura: `${dia}T16:00:00.000Z`, status: 'cancelada', dataConclusao: null, motivo: textos[7] })
  const { corpo, texto } = await chamar(periodo(dia, dia))
  assert.ok(deste(corpo.ordens).some(o => o.id === os), 'controle: a OS deveria sair')
  for (const t of textos) assert.equal(texto.includes(t), false, `"${t}" não pode sair na resposta`)
})

test('nome da peça do catálogo não sai; o item sai com tipo, quantidade e valor', async () => {
  const catalogo = await linha(sql`insert into pecas_catalogo (nome, valor, conta_id) values ('PecaCatalogoSintetica325', 10, ${A.contaId}) returning id`)
  pecaIds.push(catalogo.id)
  const dia = '2026-03-22'
  const os = await semearOS({ lojaId: A1, abertaPor: A.abertaPorId, dataAbertura: `${dia}T15:00:00.000Z` })
  await semearItem(os, { tipo: 'peca', quantidade: 1, valorUnitario: 10, pecaId: catalogo.id, descricao: 'Peça livre 325' })
  const { corpo, texto } = await chamar(periodo(dia, dia))
  assert.equal(texto.includes('PecaCatalogoSintetica325'), false)
  const saida = deste(corpo.ordens).find(o => o.id === os)
  assert.deepEqual(saida?.itens, [{ tipo: 'peca', quantidade: 1, valorUnitario: 10, valor: 10 }])
})

test('técnico sai com o id do usuário e o nome; OS sem técnico sai com técnico nulo', async () => {
  const dia = '2026-03-23'
  const com = await semearOS({ lojaId: A1, abertaPor: A.abertaPorId, mecanicoId: A.tecnicoId, dataAbertura: `${dia}T15:00:00.000Z` })
  const sem = await semearOS({ lojaId: A1, abertaPor: A.abertaPorId, mecanicoId: null, dataAbertura: `${dia}T16:00:00.000Z` })
  const { corpo } = await chamar(periodo(dia, dia))
  const comTecnico = deste(corpo.ordens).find(o => o.id === com)
  assert.deepEqual(comTecnico?.tecnico, { id: A.tecnicoId, nome: 'Técnica Sintética 325 A' })
  assert.equal(deste(corpo.ordens).find(o => o.id === sem)?.tecnico, null)
})

test('moto do estoque sai só com chassi; moto de fora sai com marca, modelo e o chassi da OS', async () => {
  const dia = '2026-03-24'
  const { motoId, chassi } = await semearMoto(A1)
  const doEstoque = await semearOS({ lojaId: A1, abertaPor: A.abertaPorId, motoId, dataAbertura: `${dia}T15:00:00.000Z` })
  const deFora = await semearOS({
    lojaId: A1, abertaPor: A.abertaPorId, motoId: null, dataAbertura: `${dia}T16:00:00.000Z`,
    marcaExterna: 'MarcaSintetica325', modeloExterno: 'ModeloSintetico325', chassiOs: 'CHASSI-OS-325',
  })
  const { corpo } = await chamar(periodo(dia, dia))
  const estoque = deste(corpo.ordens).find(o => o.id === doEstoque)
  assert.deepEqual({ chassi: estoque?.chassi, marca: estoque?.marca, modelo: estoque?.modelo }, { chassi, marca: null, modelo: null })
  const fora = deste(corpo.ordens).find(o => o.id === deFora)
  assert.deepEqual({ chassi: fora?.chassi, marca: fora?.marca, modelo: fora?.modelo }, { chassi: 'CHASSI-OS-325', marca: 'MarcaSintetica325', modelo: 'ModeloSintetico325' })
})

test('todos os status saem como estão no banco; só a concluída tem data de conclusão; a cancelada sai sem motivo', async () => {
  const dia = '2026-03-25'
  const status = ['aberta', 'oficina', 'em_andamento', 'finalizada', 'pendente_pagamento', 'concluida', 'cancelada']
  const ids = new Map<string, string>()
  for (const [i, s] of status.entries()) {
    const id = await semearOS({
      lojaId: A1, abertaPor: A.abertaPorId, status: s, dataAbertura: `${dia}T${String(10 + i).padStart(2, '0')}:00:00.000Z`,
      dataConclusao: s === 'concluida' ? `${dia}T23:00:00.000Z` : null,
      motivo: s === 'cancelada' ? 'MotivoDeCancelamentoSintetico325' : null,
    })
    ids.set(s, id)
  }
  const { corpo } = await chamar(periodo(dia, dia))
  const saidas = new Map(deste(corpo.ordens).map(o => [o.id, o]))
  for (const [s, id] of ids) assert.equal(saidas.get(id)?.status, s)
  assert.equal(saidas.get(ids.get('concluida')!)?.conclusao, '2026-03-25T23:00:00.000Z')
  assert.equal(saidas.get(ids.get('aberta')!)?.conclusao, null)
  assert.equal(Object.keys(saidas.get(ids.get('cancelada')!) ?? {}).includes('motivo'), false)
})

test('OS de agendamento sai como OS, sem o vínculo com o agendamento', async () => {
  const dia = '2026-03-26'
  const agendamentoId = (await linha(sql`insert into agendamentos (loja_id, cliente_nome, cliente_fone, tipo_servico, data_hora_inicio)
    values (${A1}, 'ClienteAgendamento325', '61999990000', 'revisao', ${`${dia}T13:00:00.000Z`}) returning id`)).id
  const os = await semearOS({ lojaId: A1, abertaPor: A.abertaPorId, dataAbertura: `${dia}T15:00:00.000Z`, agendamentoId })
  const { corpo } = await chamar(periodo(dia, dia))
  const saida = deste(corpo.ordens).find(o => o.id === os)
  assert.ok(saida, 'a OS vinda de agendamento deveria sair')
  assert.equal(Object.keys(saida).includes('agendamentoId'), false)
})

test('itens: serviço vira mão de obra, peça vira peça; valor da linha é quantidade vezes unitário, com 2 casas', async () => {
  const dia = '2026-03-27'
  const os = await semearOS({ lojaId: A1, abertaPor: A.abertaPorId, dataAbertura: `${dia}T15:00:00.000Z` })
  await semearItem(os, { tipo: 'servico', quantidade: 2, valorUnitario: 150.5 })
  await semearItem(os, { tipo: 'peca', quantidade: 1.5, valorUnitario: 99.99 })
  const { corpo } = await chamar(periodo(dia, dia))
  const saida = deste(corpo.ordens).find(o => o.id === os)
  assert.deepEqual(saida?.itens, [
    { tipo: 'mao_de_obra', quantidade: 2, valorUnitario: 150.5, valor: 301 },
    { tipo: 'peca', quantidade: 1.5, valorUnitario: 99.99, valor: 149.99 },
  ])
})

test('item de tipo fora da lista não sai', async () => {
  const dia = '2026-03-28'
  const os = await semearOS({ lojaId: A1, abertaPor: A.abertaPorId, dataAbertura: `${dia}T15:00:00.000Z` })
  await semearItem(os, { tipo: 'servico', quantidade: 1, valorUnitario: 50 })
  await semearItem(os, { tipo: 'outro', quantidade: 1, valorUnitario: 999 })
  const { corpo } = await chamar(periodo(dia, dia))
  const saida = deste(corpo.ordens).find(o => o.id === os)
  assert.deepEqual(saida?.itens.map(i => i.tipo), ['mao_de_obra'])
})

test('no cenário semeado, a soma dos itens bate com o total gravado da OS', async () => {
  const dia = '2026-03-29'
  const os = await semearOS({ lojaId: A1, abertaPor: A.abertaPorId, dataAbertura: `${dia}T15:00:00.000Z`, valorTotal: 371 })
  await semearItem(os, { tipo: 'servico', quantidade: 2, valorUnitario: 150.5 })
  await semearItem(os, { tipo: 'peca', quantidade: 1, valorUnitario: 40 })
  await semearItem(os, { tipo: 'peca', quantidade: 3, valorUnitario: 10 })
  const { corpo } = await chamar(periodo(dia, dia))
  const saida = deste(corpo.ordens).find(o => o.id === os)
  assert.ok(saida)
  assert.equal(saida.itens.reduce((soma, i) => soma + i.valor, 0), saida.total)
  assert.equal(saida.total, 371)
})

test('OS sem item sai com lista vazia', async () => {
  const dia = '2026-03-30'
  const os = await semearOS({ lojaId: A1, abertaPor: A.abertaPorId, dataAbertura: `${dia}T15:00:00.000Z` })
  const { corpo } = await chamar(periodo(dia, dia))
  assert.deepEqual(deste(corpo.ordens).find(o => o.id === os)?.itens, [])
})

test('período pela data de abertura em Brasília: 31/03 às 21:30 entra em 31/03 e não em 01/04; 01/04 à meia-noite entra em 01/04', async () => {
  const meiaNoiteBrasil = await semearOS({ lojaId: A1, abertaPor: A.abertaPorId, dataAbertura: '2026-04-01T03:00:00.000Z' })
  const noite = await semearOS({ lojaId: A1, abertaPor: A.abertaPorId, dataAbertura: '2026-04-01T00:30:00.000Z' })
  const ultimoInstante = await semearOS({ lojaId: A1, abertaPor: A.abertaPorId, dataAbertura: '2026-04-01T02:59:59.999Z' })
  const dia31 = deste((await chamar(periodo('2026-03-31', '2026-03-31'))).corpo.ordens).map(o => o.id)
  assert.equal(dia31.includes(noite), true)
  assert.equal(dia31.includes(ultimoInstante), true)
  assert.equal(dia31.includes(meiaNoiteBrasil), false)
  const dia1 = deste((await chamar(periodo('2026-04-01', '2026-04-01'))).corpo.ordens).map(o => o.id)
  assert.equal(dia1.includes(meiaNoiteBrasil), true)
  assert.equal(dia1.includes(noite), false)
})

test('período inválido, de 93 dias ou antes de 2026 dá erro da lista fixa, sem eco do valor', async () => {
  for (const query of [`?de=lixo325&ate=2026-03-01`, periodo('2026-01-01', '2026-04-03'), periodo('2025-12-31', '2026-01-10')]) {
    const { status, corpo, texto } = await chamar(query)
    assert.equal(status, 400)
    assert.deepEqual({ codigo: corpo.codigo, frase: corpo.frase }, { codigo: 'parametro_invalido', frase: 'Parâmetro inválido.' })
    assert.equal(texto.includes('lixo325'), false)
  }
})

test('cursor que não é válido, ou que aponta para uma data fora do período, dá erro da lista fixa', async () => {
  const forjado = Buffer.from(JSON.stringify({ d: '2026-05-01T00:00:00.000Z', i: randomUUID() })).toString('base64url')
  for (const cursor of ['nao-e-cursor!', forjado]) {
    const { status, corpo } = await chamar(`${periodo('2026-03-20', '2026-03-20')}&cursor=${cursor}`)
    assert.equal(status, 400)
    assert.equal(corpo.codigo, 'parametro_invalido')
  }
})

test('OS de mesma data saem na ordem do id; a de maior id, inserida primeiro, sai por último', async () => {
  const dia = '2026-03-31'
  const [menor, maior] = [randomUUID(), randomUUID()].sort()
  const instante = '2026-03-31T12:00:00.000Z'
  await semearOS({ id: maior, lojaId: A1, abertaPor: A.abertaPorId, dataAbertura: instante })
  await semearOS({ id: menor, lojaId: A1, abertaPor: A.abertaPorId, dataAbertura: instante })
  const { corpo } = await chamar(periodo(dia, dia))
  const ids = deste(corpo.ordens).map(o => o.id).filter(id => id === menor || id === maior)
  assert.deepEqual(ids, [menor, maior])
})

test('501 OS no mesmo instante: página 1 com 500 e cursor; a 501ª na página seguinte; nenhuma repetida nem perdida', async () => {
  const dia = '2026-04-14'
  await semear501NoMesmoInstante(A1, A.abertaPorId, `${dia}T12:00:00.000Z`)
  const paginas = await percorrer(periodo(dia, dia))
  assert.equal(paginas[0].ordens?.length, 500)
  assert.ok(paginas[0].proximaPagina, 'a primeira página deveria apontar para a próxima')
  const ids = paginas.flatMap(p => deste(p.ordens).map(o => o.id))
  assert.equal(ids.length, 501)
  assert.equal(new Set(ids).size, 501)
})

test('OS nova com data anterior ao cursor, entre as páginas, não repete nem faz perder nenhuma', async () => {
  const dia = '2026-04-16'
  await semear501NoMesmoInstante(A1, A.abertaPorId, `${dia}T12:00:00.000Z`)
  const primeira = await chamar(periodo(dia, dia))
  const anterior = await semearOS({ lojaId: A1, abertaPor: A.abertaPorId, dataAbertura: `${dia}T08:00:00.000Z` })
  const segunda = await chamar(`${periodo(dia, dia)}&cursor=${primeira.corpo.proximaPagina}`)
  const idsPrimeira = deste(primeira.corpo.ordens).map(o => o.id)
  const idsSegunda = deste(segunda.corpo.ordens).map(o => o.id)
  assert.equal(idsSegunda.some(id => idsPrimeira.includes(id)), false, 'nenhuma OS da página 1 pode voltar na página 2')
  assert.equal(idsPrimeira.includes(anterior) || idsSegunda.includes(anterior), false, 'a OS anterior ao cursor não entra nesta passada')
  assert.equal(idsSegunda.length, 1)
})

test('fronteira: só loja marcada de Conta e grupo ativos sai; loja não marcada, de Conta desativada e de grupo inativo não saem', async () => {
  const dia = '2026-03-18'
  const doA1 = await semearOS({ lojaId: A1, abertaPor: A.abertaPorId, dataAbertura: `${dia}T15:00:00.000Z` })
  const doA2 = await semearOS({ lojaId: A2, abertaPor: A.abertaPorId, dataAbertura: `${dia}T15:00:00.000Z` })
  const doB1 = await semearOS({ lojaId: B1, abertaPor: B.abertaPorId, dataAbertura: `${dia}T15:00:00.000Z` })
  const doC1 = await semearOS({ lojaId: C1, abertaPor: C.abertaPorId, dataAbertura: `${dia}T15:00:00.000Z` })
  const doD1 = await semearOS({ lojaId: D1, abertaPor: D.abertaPorId, dataAbertura: `${dia}T15:00:00.000Z` })
  const { corpo } = await chamar(periodo(dia, dia))
  const ids = deste(corpo.ordens).map(o => o.id)
  assert.equal(ids.filter(id => id === doA1).length, 1, 'a OS da loja marcada deveria sair uma vez')
  assert.equal(ids.filter(id => id === doB1).length, 1, 'a OS da loja marcada de outra Conta deveria sair uma vez')
  assert.equal(ids.includes(doA2), false)
  assert.equal(ids.includes(doC1), false)
  assert.equal(ids.includes(doD1), false)
})

test('parâmetro de loja, grupo ou Conta na URL não amplia o que sai', async () => {
  const dia = '2026-03-19'
  const doC1 = await semearOS({ lojaId: C1, abertaPor: C.abertaPorId, dataAbertura: `${dia}T15:00:00.000Z` })
  const doB1 = await semearOS({ lojaId: B1, abertaPor: B.abertaPorId, dataAbertura: `${dia}T15:00:00.000Z` })
  const semParametro = deste((await chamar(periodo(dia, dia))).corpo.ordens).map(o => o.id)
  assert.equal(semParametro.includes(doB1), true, "controle: a OS da loja marcada de outra Conta deveria sair")
  const comParametro = deste((await chamar(`${periodo(dia, dia)}&loja=${C1}&grupo=${C.grupoId}&conta=${C.contaId}`)).corpo.ordens).map(o => o.id)
  assert.deepEqual(comParametro, semParametro)
  assert.equal(comParametro.includes(doC1), false)
})

test('registro de acesso: período e quantidade de OS devolvidas quando deu certo; sem período quando a chamada foi recusada', async () => {
  const ok = await chamar(periodo('2026-03-20', '2026-03-20'))
  const recusada = await chamar(periodo('lixo325', '2026-03-20'))
  await esperarRegistros()
  const [registroOk] = await execRows(sql`select endpoint, status, periodo_ini, periodo_fim, linhas from api_acessos where user_agent = ${ok.ua}`)
  assert.equal(registroOk.endpoint, ENDPOINT)
  assert.equal(registroOk.status, 200)
  assert.equal(registroOk.periodo_ini, '2026-03-20')
  assert.equal(registroOk.periodo_fim, '2026-03-20')
  assert.equal(registroOk.linhas, ok.corpo.ordens?.length)
  const [registroRecusada] = await execRows(sql`select status, periodo_ini from api_acessos where user_agent = ${recusada.ua}`)
  assert.equal(registroRecusada.status, 400)
  assert.equal(registroRecusada.periodo_ini, null)
})

test('500 OS com itens no período: cada OS sai uma vez, com 2 ou 3 itens, e a página não tem próxima', async () => {
  const dia = '2026-05-04'
  const instante = `${dia}T12:00:00.000Z`
  await semear501NoMesmoInstante(A1, A.abertaPorId, instante, 500)
  await semearItensNasOS(A1, instante)
  const { status, corpo } = await chamar(periodo(dia, dia))
  assert.equal(status, 200)
  const ours = deste(corpo.ordens)
  assert.equal(ours.length, 500)
  assert.equal(new Set(ours.map(o => o.id)).size, 500)
  assert.equal(corpo.proximaPagina, null)
  const tamanhos = ours.map(o => o.itens.length)
  assert.equal(tamanhos.every(n => n === 2 || n === 3), true, 'cada OS da massa tem 2 ou 3 itens')
  assert.equal(tamanhos.includes(3), true)
})

test('501 OS com itens: 500 na primeira página com cursor e a 501ª na segunda, cada OS uma vez', async () => {
  const dia = '2026-05-05'
  const instante = `${dia}T12:00:00.000Z`
  await semear501NoMesmoInstante(A1, A.abertaPorId, instante, 501)
  await semearItensNasOS(A1, instante)
  const paginas = await percorrer(periodo(dia, dia))
  assert.equal(paginas[0].ordens?.length, 500)
  assert.ok(paginas[0].proximaPagina, 'a primeira página deveria apontar para a próxima')
  const ours = paginas.flatMap(p => deste(p.ordens))
  assert.equal(ours.length, 501)
  assert.equal(new Set(ours.map(o => o.id)).size, 501)
})

test('OS no último microssegundo do dia de Brasília entra nesse dia; a do instante seguinte entra no dia de amanhã', async () => {
  const ultima = await semearOS({ lojaId: A1, abertaPor: A.abertaPorId, dataAbertura: '2026-05-11T02:59:59.999999Z' })
  const primeira = await semearOS({ lojaId: A1, abertaPor: A.abertaPorId, dataAbertura: '2026-05-11T03:00:00.000000Z' })
  const dia10 = deste((await chamar(periodo('2026-05-10', '2026-05-10'))).corpo.ordens).map(o => o.id)
  const dia11 = deste((await chamar(periodo('2026-05-11', '2026-05-11'))).corpo.ordens).map(o => o.id)
  assert.equal(dia10.includes(ultima), true, 'o último microssegundo de 10/05 deveria entrar em 10/05')
  assert.equal(dia11.includes(ultima), false)
  assert.equal(dia11.includes(primeira), true)
  assert.equal(dia10.includes(primeira), false)
})

test('OS no mesmo milissegundo saem pela ordem do id, mesmo com microssegundos diferentes; o corte de página não repete nem perde', async () => {
  const dia = '2026-05-12'
  await semear501NoMesmoInstante(A1, A.abertaPorId, `${dia}T10:00:00.000000Z`, 499)
  const [menor, maior] = [randomUUID(), randomUUID()].sort()
  await semearOS({ id: maior, lojaId: A1, abertaPor: A.abertaPorId, dataAbertura: `${dia}T15:00:00.123100Z` })
  await semearOS({ id: menor, lojaId: A1, abertaPor: A.abertaPorId, dataAbertura: `${dia}T15:00:00.123400Z` })
  const paginas = await percorrer(periodo(dia, dia))
  assert.equal(paginas.length, 2)
  const primeira = deste(paginas[0].ordens).map(o => o.id)
  assert.equal(primeira.includes(menor), true, 'a OS de menor id fica na primeira página')
  assert.equal(primeira.includes(maior), false)
  assert.deepEqual(deste(paginas[1].ordens).map(o => o.id), [maior])
})

test('cliente do cadastro ligado à OS não sai: nome, documento, telefone, e-mail, endereço e o id dele ficam fora da resposta', async () => {
  const cliente = await linha(sql`insert into clientes (nome, cpf_cnpj, celular, email, endereco, conta_id)
    values ('ClienteCadastroSintetico325', '44455566677', '61988887777', 'cadastro325@teste.invalid', 'EnderecoCadastroSintetico325', ${A.contaId}) returning id`)
  const agendamentoId = (await linha(sql`insert into agendamentos (loja_id, cliente_nome, cliente_fone, tipo_servico, data_hora_inicio)
    values (${A1}, 'ClienteAgendamento325', '61999990000', 'revisao', '2026-05-13T13:00:00.000Z') returning id`)).id
  const dia = '2026-05-13'
  const os = await semearOS({ lojaId: A1, abertaPor: A.abertaPorId, dataAbertura: `${dia}T15:00:00.000Z`, clienteId: cliente.id, agendamentoId })
  const { corpo, texto } = await chamar(periodo(dia, dia))
  assert.ok(deste(corpo.ordens).some(o => o.id === os), 'controle: a OS com cliente do cadastro deveria sair')
  for (const t of ['ClienteCadastroSintetico325', '44455566677', '61988887777', 'cadastro325@teste.invalid', 'EnderecoCadastroSintetico325', cliente.id, agendamentoId]) {
    assert.equal(texto.includes(t), false, `"${t}" não pode sair na resposta`)
  }
})

// Lê todas as páginas do período, na ordem que a API devolve, até não haver próxima.
async function percorrer(query: string): Promise<Corpo[]> {
  const paginas: Corpo[] = []
  let cursor: string | null = null
  for (let k = 0; k < 20; k++) {
    const r = await chamar(cursor ? `${query}&cursor=${cursor}` : query)
    assert.equal(r.status, 200)
    paginas.push(r.corpo)
    cursor = r.corpo.proximaPagina ?? null
    if (!cursor) break
  }
  return paginas
}
