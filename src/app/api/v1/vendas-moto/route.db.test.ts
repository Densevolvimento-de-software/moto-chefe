// Teste de banco: GET /api/v1/vendas-moto (#323) chamado com um Request, no banco do test:db.
// Dados gravados de verdade e apagados no after. Os arquivos do test:db rodam em paralelo no mesmo banco:
// cada conferência filtra pelos ids das lojas deste teste, e os dias usados são de janeiro e fevereiro de 2026.
import { after, before, mock, test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { NextRequest } from 'next/server'
import { apagarContasSemeadas, semearContaBase, semearLoja, semearUsuario } from '@/test/semear-conta'
import { mockAfterDaResposta } from '@/test/after-resposta'

const url = process.env.TEST_DATABASE_URL
if (!url) throw new Error('TEST_DATABASE_URL não definida — este teste só roda num Postgres descartável')
if (!['localhost', '127.0.0.1'].includes(new URL(url).hostname)) {
  throw new Error('TEST_DATABASE_URL precisa ser loopback (Postgres descartável)')
}
process.env.DATABASE_URL = url

type Usuario = { id: string; papel: string; lojaId: string; contaId: string; gruposAcesso: string[] }
let usuario: Usuario
// A cancelar venda vem da action real; a sessão é a fronteira de fora (quem entrou).
const authMock = mock.module('@/lib/auth', { namedExports: { getUsuarioLogado: async () => usuario } })
const cacheMock = mock.module('next/cache', { namedExports: { revalidatePath: () => {} } })
// Storage é a fronteira de fora: a venda deste teste não tem documento, então nada deveria ser pedido.
const storageMock = mock.module('@supabase/supabase-js', {
  namedExports: { createClient: () => ({ storage: { from: () => ({ remove: async () => ({ error: null }) }) } }) },
})

type Db = typeof import('@/lib/db')
type Schema = typeof import('@/lib/db/schema')
type Rota = typeof import('./route')
let db: Db['db']
let execRows: Db['execRows']
let apiChaves: Schema['apiChaves']
let apiAcessos: Schema['apiAcessos']
let apiLimite: Schema['apiLimite']
let esperarRegistros: () => Promise<void>
let GET: Rota['GET']
let vendasDoPainel: typeof import('@/lib/queries/painel-fabrica')['vendasDoPainel']
let cancelarVendaCompletaAction: typeof import('@/app/(dashboard)/vendas/actions')['cancelarVendaCompletaAction']

const ENDPOINT = '/api/v1/vendas-moto'
const DIA = { janeiro: '2026-01-25', fevereiro: '2026-02-10', virada: '2026-02-27', viradaSeguinte: '2026-02-28' }
const HORA = 60 * 60 * 1000
const sha = (texto: string) => createHash('sha256').update(texto).digest('hex')

// Valores do cliente sintético: nenhum deles pode aparecer na resposta. O CEP é o único que sai.
const CLIENTE = {
  nome: 'NomeClienteSintetico323', cpf: '98765432100', celular: '35911112222', email: 'cliente323@teste.invalid',
  logradouro: 'LogradouroSintetico323', numero: 'NumeroSintetico323', complemento: 'ComplementoSintetico323',
  bairro: 'BairroSintetico323', cidade: 'CidadeSintetica323', estado: 'UFSintetica323',
  representanteNome: 'RepresentanteSintetico323', representanteCpf: '11122233344', ie: 'IESintetica323',
}
const CEP = '30140071'

const hashes: string[] = []
const uas: string[] = []
const uaNovo = () => {
  const ua = `vm323-${randomUUID()}`
  uas.push(ua)
  return ua
}
const contaIds: string[] = []
const grupoIds: string[] = []
const lojaIds: string[] = []
const prefixos: string[] = []

async function gravarChave(token: string) {
  hashes.push(sha(token))
  await db.insert(apiChaves).values({ hash: sha(token), geradaPor: randomUUID(), validaAte: new Date(Date.now() + 365 * 24 * HORA) })
}
const CHAVE = `chave-vm323-${randomUUID()}`

type Venda = {
  data: string; numero: number; loja: { id: string; nome: string }; vendedor: { id: string; nome: string }
  modelo: string; cor: string; chassi: string; valor: number; custo: number | null; cepCliente: string | null; numeroNf: string | null
}
type Corpo = { de?: string; ate?: string; vendas?: Venda[]; proximaPagina?: string | null; codigo?: string; frase?: string }

async function chamar(query: string, token: string | null = CHAVE) {
  const ua = uaNovo()
  const headers = new Headers({ 'user-agent': ua, 'x-forwarded-for': '200.3.2.1' })
  if (token !== null) headers.set('authorization', `Bearer ${token}`)
  const resposta = await GET(new NextRequest(`http://localhost${ENDPOINT}${query}`, { headers }))
  const texto = await resposta.text()
  return { status: resposta.status, texto, corpo: JSON.parse(texto) as Corpo, ua }
}
const periodo = (de: string, ate: string) => `?de=${de}&ate=${ate}`

type Conta = { contaId: string; grupoId: string; prefixo: string; vendedorId: string; vendedorHomonimoId: string }

async function semearConta(letra: string, cnpj: string, opcoes: { autorizada?: boolean; desativada?: boolean; grupoInativo?: boolean } = {}): Promise<Conta> {
  const prefixo = `VM323${letra}`
  const base = await semearContaBase(db, { prefixo, nome: `Conta ${prefixo} ${randomUUID()}`, cnpj })
  contaIds.push(base.contaId)
  grupoIds.push(base.grupoId)
  lojaIds.push(base.lojaId)
  prefixos.push(prefixo)
  await db.execute(sql`update contas set autoriza_custo_despesa_meta = ${opcoes.autorizada ?? false}, desativada_em = ${opcoes.desativada ? sql`now()` : null} where id = ${base.contaId}`)
  if (opcoes.grupoInativo) await db.execute(sql`update grupos set ativo = false where id = ${base.grupoId}`)
  const vendedorId = await semearUsuario(db, base, { papel: 'aux_adm', rotulo: `vend${letra}`, nomeDoUsuario: 'Vendedora Homônima 323', comConta: true })
  const vendedorHomonimoId = await semearUsuario(db, base, { papel: 'aux_adm', rotulo: `homo${letra}`, nomeDoUsuario: 'Vendedora Homônima 323', comConta: true })
  return { contaId: base.contaId, grupoId: base.grupoId, prefixo, vendedorId, vendedorHomonimoId }
}

async function semearLojaNaConta(c: Conta, nome: string, { marcada = false, painel = false }: { marcada?: boolean; painel?: boolean }) {
  const id = await semearLoja(db, c.grupoId, nome)
  lojaIds.push(id)
  await db.execute(sql`update lojas set loja_motochefe = ${marcada}, fabrica_email = ${painel ? 'portal-sintetico-323@teste.invalid' : null} where id = ${id}`)
  return id
}

const linha = async (q: ReturnType<typeof sql>) => (await execRows(q))[0] as { id: string }

async function modeloDe(marca: 'MotoChefe' | 'Voi') {
  const nome = `M323 ${marca} ${randomUUID()}`
  return (await linha(sql`insert into modelos (marca, modelo, categoria, potencia_w, motor, velocidade_max)
    values (${marca}, ${nome}, 'autopropelido', '1000', 'hub', '32') returning id`)).id
}

type VendaSemeada = { id: string; numero: number; motoId: string }
type Opcoes = {
  lojaId: string; vendedorId: string; marca?: 'MotoChefe' | 'Voi'; modeloId?: string; dataVenda: string
  valor?: number; precoCompra?: number | null; cliente?: boolean; cep?: string | null; nomeVendedor?: string
}

async function semearVenda(o: Opcoes): Promise<VendaSemeada> {
  const modeloId = o.modeloId ?? await modeloDe(o.marca ?? 'MotoChefe')
  const motoId = (await linha(sql`insert into motos (chassi, modelo_id, loja_id, cor, nota_fiscal_entrada, status, disponibilidade, preco_compra)
    values (${randomUUID()}, ${modeloId}, ${o.lojaId}, 'PRETO', '1', 'vendida', 'vendida', ${o.precoCompra ?? null}) returning id`)).id
  const pedidoId = (await linha(sql`insert into pedidos_venda (moto_id, loja_id, vendedor_id) values (${motoId}, ${o.lojaId}, ${o.vendedorId}) returning id`)).id
  const cliente = o.cliente === false ? null : CLIENTE
  const venda = await execRows(sql`insert into vendas (pedido_venda_id, moto_id, loja_id, vendedor_id, efetivado_por,
      cliente_nome, cliente_cpf, cliente_celular, cliente_email, cliente_cep, cliente_logradouro, cliente_numero, cliente_complemento,
      cliente_bairro, cliente_cidade, cliente_estado, representante_nome, representante_cpf, cliente_inscricao_estadual,
      valor, forma_pagamento, data_venda)
    values (${pedidoId}, ${motoId}, ${o.lojaId}, ${o.vendedorId}, ${o.vendedorId},
      ${cliente?.nome ?? 'Cliente sem dado'}, ${cliente?.cpf ?? '00000000000'}, ${cliente?.celular ?? null}, ${cliente?.email ?? null},
      ${o.cep === undefined ? CEP : o.cep}, ${cliente?.logradouro ?? null}, ${cliente?.numero ?? null}, ${cliente?.complemento ?? null},
      ${cliente?.bairro ?? null}, ${cliente?.cidade ?? null}, ${cliente?.estado ?? null}, ${cliente?.representanteNome ?? null},
      ${cliente?.representanteCpf ?? null}, ${cliente?.ie ?? null},
      ${o.valor ?? 1000}, 'pix', ${o.dataVenda}) returning id, numero`)
  return { id: venda[0].id as string, numero: venda[0].numero as number, motoId }
}

async function semearNf(vendaId: string, grupoId: string, vendaNumero: number, ambiente: string, status: string, numero: string | null) {
  await db.execute(sql`insert into notas_fiscais_saida (venda_id, venda_numero, grupo_id, id_externo, ambiente, status, numero, payload)
    values (${vendaId}, ${vendaNumero}, ${grupoId}, ${randomUUID()}, ${ambiente}, ${status}, ${numero}, '{}'::jsonb)`)
}

// Período de um dia só: o retorno do endpoint é para as lojas deste teste (o global é filtrado na conferência).
const deste = <T extends { loja: { id: string } }>(vendas: T[] = []) => vendas.filter(v => lojaIds.includes(v.loja.id))

// Contas e lojas deste teste. Marcada = admin_geral ligou a loja; painel = a loja tem login da fábrica.
let A: Conta, B: Conta, C: Conta, D: Conta
let A1: string, A2: string, B1: string, B2: string, C1: string, D1: string
let VENDEDORA_A: string, VENDEDORA_A2: string

before(async () => {
  ;({ esperarRegistros } = await mockAfterDaResposta())
  ;({ db, execRows } = await import('@/lib/db'))
  ;({ apiChaves, apiAcessos, apiLimite } = await import('@/lib/db/schema'))
  ;({ GET } = await import('./route'))
  ;({ vendasDoPainel } = await import('@/lib/queries/painel-fabrica'))
  ;({ cancelarVendaCompletaAction } = await import('@/app/(dashboard)/vendas/actions'))

  A = await semearConta('A', '32323000000001', { autorizada: true })
  B = await semearConta('B', '32323000000002', { autorizada: false })
  C = await semearConta('C', '32323000000003', { autorizada: true, desativada: true })
  D = await semearConta('D', '32323000000004', { autorizada: true, grupoInativo: true })
  A1 = await semearLojaNaConta(A, 'Loja 323 A1', { marcada: true, painel: true })
  A2 = await semearLojaNaConta(A, 'Loja 323 A2', { painel: true })
  B1 = await semearLojaNaConta(B, 'Loja 323 B1', { marcada: true, painel: true })
  B2 = await semearLojaNaConta(B, 'Loja 323 B2', { marcada: true })
  C1 = await semearLojaNaConta(C, 'Loja 323 C1', { marcada: true })
  D1 = await semearLojaNaConta(D, 'Loja 323 D1', { marcada: true })
  VENDEDORA_A = A.vendedorId
  VENDEDORA_A2 = A.vendedorHomonimoId

  await gravarChave(CHAVE)
})

after(async () => {
  const idsDasChaves = await execRows(sql`select id from api_chaves where hash = any(${sql.param(hashes)}::text[])`)
  const chaveIds = idsDasChaves.map(l => l.id as string)
  if (chaveIds.length > 0) {
    await db.delete(apiAcessos).where(sql`chave_id = any(${sql.param(chaveIds)}::uuid[])`)
    await db.delete(apiLimite).where(sql`chave_id = any(${sql.param(chaveIds)}::uuid[])`)
  }
  await db.delete(apiAcessos).where(sql`user_agent = any(${sql.param(uas)}::text[])`)
  await db.delete(apiChaves).where(sql`hash = any(${sql.param(hashes)}::text[])`)
  await db.execute(sql`delete from historico_estoque where loja_destino_id = any(${sql.param(lojaIds)}::uuid[])`)
  await db.execute(sql`delete from notas_fiscais_saida where venda_id in (select id from vendas where loja_id = any(${sql.param(lojaIds)}::uuid[]))`)
  await db.execute(sql`delete from vendas where loja_id = any(${sql.param(lojaIds)}::uuid[])`)
  await db.execute(sql`delete from pedidos_venda where loja_id = any(${sql.param(lojaIds)}::uuid[])`)
  await db.execute(sql`delete from motos where loja_id = any(${sql.param(lojaIds)}::uuid[])`)
  await db.execute(sql`delete from precificacao where grupo_id = any(${sql.param(grupoIds)}::uuid[])`)
  await db.execute(sql`delete from log_acoes where grupo_id = any(${sql.param(grupoIds)}::uuid[])`)
  await db.execute(sql`delete from modelos where modelo like 'M323 %'`)
  for (const [i, contaId] of contaIds.entries()) {
    await apagarContasSemeadas(db, { contaIds: [contaId], prefixo: prefixos[i] })
  }
  await (globalThis as { __pgPool?: { end(): Promise<void> } }).__pgPool?.end()
})

test('chave válida: sai a venda MotoChefe das lojas marcadas, com a lista de colunas', async () => {
  const v = await semearVenda({ lojaId: A1, vendedorId: VENDEDORA_A, dataVenda: '2026-02-10T15:00:00.000Z', valor: 1000, precoCompra: 700 })
  const { status, corpo } = await chamar(periodo(DIA.fevereiro, DIA.fevereiro))
  assert.equal(status, 200)
  const linhaV = deste(corpo.vendas).find(x => x.numero === v.numero)
  assert.ok(linhaV, 'a venda da loja marcada deveria sair')
  assert.deepEqual(Object.keys(linhaV).sort(), ['cepCliente', 'chassi', 'cor', 'custo', 'data', 'loja', 'modelo', 'numero', 'numeroNf', 'valor', 'vendedor'])
  assert.deepEqual(Object.keys(linhaV.loja).sort(), ['id', 'nome'])
  assert.deepEqual(Object.keys(linhaV.vendedor).sort(), ['id', 'nome'])
  assert.equal(linhaV.data, '2026-02-10')
  assert.equal(linhaV.valor, 1000)
  assert.equal(linhaV.loja.id, A1)
  assert.equal(linhaV.vendedor.id, VENDEDORA_A)
  assert.equal(linhaV.vendedor.nome, 'Vendedora Homônima 323')
  assert.equal(linhaV.cepCliente, CEP)
  assert.equal(corpo.de, DIA.fevereiro)
  assert.equal(corpo.ate, DIA.fevereiro)
})

test('moto de outra marca numa loja marcada não sai; a MotoChefe da mesma loja sai', async () => {
  const voi = await semearVenda({ lojaId: A1, vendedorId: VENDEDORA_A, marca: 'Voi', dataVenda: '2026-02-10T15:00:00.000Z', valor: 500 })
  const motoChefe = await semearVenda({ lojaId: A1, vendedorId: VENDEDORA_A, dataVenda: '2026-02-10T15:00:00.000Z', valor: 501 })
  const { corpo } = await chamar(periodo(DIA.fevereiro, DIA.fevereiro))
  assert.equal(deste(corpo.vendas).some(x => x.numero === motoChefe.numero), true, 'controle: a MotoChefe da loja marcada deveria sair')
  assert.equal(deste(corpo.vendas).some(x => x.numero === voi.numero), false)
})

test('loja com login da fábrica mas não marcada não sai; loja marcada sem login sai', async () => {
  const soPainel = await semearVenda({ lojaId: A2, vendedorId: VENDEDORA_A, dataVenda: '2026-02-10T15:00:00.000Z' })
  const soMarcada = await semearVenda({ lojaId: B2, vendedorId: VENDEDORA_A, dataVenda: '2026-02-10T15:00:00.000Z' })
  const { corpo } = await chamar(periodo(DIA.fevereiro, DIA.fevereiro))
  assert.equal(deste(corpo.vendas).some(x => x.numero === soPainel.numero), false)
  assert.equal(deste(corpo.vendas).some(x => x.numero === soMarcada.numero), true)
})

test('loja marcada de Conta desativada ou de grupo inativo não sai', async () => {
  const daDesativada = await semearVenda({ lojaId: C1, vendedorId: VENDEDORA_A, dataVenda: '2026-02-10T15:00:00.000Z' })
  const deGrupoInativo = await semearVenda({ lojaId: D1, vendedorId: VENDEDORA_A, dataVenda: '2026-02-10T15:00:00.000Z' })
  const daMarcada = await semearVenda({ lojaId: B2, vendedorId: VENDEDORA_A, dataVenda: '2026-02-10T15:00:00.000Z' })
  const { corpo } = await chamar(periodo(DIA.fevereiro, DIA.fevereiro))
  assert.equal(deste(corpo.vendas).some(x => x.numero === daMarcada.numero), true, 'controle: a venda de loja marcada de Conta ativa deveria sair')
  assert.equal(deste(corpo.vendas).some(x => x.numero === daDesativada.numero), false)
  assert.equal(deste(corpo.vendas).some(x => x.numero === deGrupoInativo.numero), false)
})

test('parâmetro de loja na URL é ignorado: mesma resposta, sem loja de fora', async () => {
  const vendaDaMarcada = await semearVenda({ lojaId: A1, vendedorId: VENDEDORA_A, dataVenda: '2026-02-10T15:00:00.000Z' })
  const vendaDeFora = await semearVenda({ lojaId: A2, vendedorId: VENDEDORA_A, dataVenda: '2026-02-10T15:00:00.000Z' })
  const semParametro = await chamar(periodo(DIA.fevereiro, DIA.fevereiro))
  const comParametro = await chamar(`${periodo(DIA.fevereiro, DIA.fevereiro)}&loja=${A2}&grupo=${A.grupoId}&conta=${B.contaId}`)
  assert.equal(deste(semParametro.corpo.vendas).some(x => x.numero === vendaDaMarcada.numero), true, 'controle: a venda da loja marcada deveria sair')
  assert.deepEqual(deste(comParametro.corpo.vendas).map(x => x.numero), deste(semParametro.corpo.vendas).map(x => x.numero))
  assert.equal(deste(comParametro.corpo.vendas).some(x => x.numero === vendaDeFora.numero), false)
})

test('duas Contas marcadas: cada venda sai uma vez, com a loja dela', async () => {
  const vA = await semearVenda({ lojaId: A1, vendedorId: VENDEDORA_A, dataVenda: '2026-02-10T15:00:00.000Z' })
  const vB = await semearVenda({ lojaId: B1, vendedorId: VENDEDORA_A, dataVenda: '2026-02-10T15:00:00.000Z' })
  const { corpo } = await chamar(periodo(DIA.fevereiro, DIA.fevereiro))
  const meus = deste(corpo.vendas)
  assert.equal(meus.filter(x => x.numero === vA.numero).length, 1)
  assert.equal(meus.filter(x => x.numero === vB.numero).length, 1)
  assert.equal(meus.find(x => x.numero === vB.numero)?.loja.id, B1)
})

test('custo sai só de Conta autorizada; sem autorização sai nulo', async () => {
  const daA = await semearVenda({ lojaId: A1, vendedorId: VENDEDORA_A, dataVenda: '2026-02-10T15:00:00.000Z', precoCompra: 700 })
  const daB = await semearVenda({ lojaId: B1, vendedorId: VENDEDORA_A, dataVenda: '2026-02-10T15:00:00.000Z', precoCompra: 1500 })
  const { corpo } = await chamar(periodo(DIA.fevereiro, DIA.fevereiro))
  assert.equal(deste(corpo.vendas).find(x => x.numero === daA.numero)?.custo, 700)
  assert.equal(deste(corpo.vendas).find(x => x.numero === daB.numero)?.custo, null)
})

test('sem preço de compra, o custo cai para a precificação do grupo da Conta autorizada', async () => {
  const modeloId = await modeloDe('MotoChefe')
  const nomeDoModelo = (await execRows(sql`select modelo from modelos where id = ${modeloId}`))[0].modelo as string
  await db.execute(sql`insert into precificacao (grupo_id, nome, valor_minimo, custo, ativo) values (${A.grupoId}, ${nomeDoModelo}, 0, 650, true)`)
  const v = await semearVenda({ lojaId: A1, vendedorId: VENDEDORA_A, modeloId, dataVenda: '2026-02-10T15:00:00.000Z', precoCompra: null })
  const { corpo } = await chamar(periodo(DIA.fevereiro, DIA.fevereiro))
  assert.equal(deste(corpo.vendas).find(x => x.numero === v.numero)?.custo, 650)
})

test('venda sem custo em lugar nenhum, de Conta autorizada, sai nula e não zero', async () => {
  const v = await semearVenda({ lojaId: A1, vendedorId: VENDEDORA_A, dataVenda: '2026-02-10T16:00:00.000Z', precoCompra: null })
  const { corpo } = await chamar(periodo(DIA.fevereiro, DIA.fevereiro))
  const linhaV = deste(corpo.vendas).find(x => x.numero === v.numero)
  assert.equal(linhaV?.custo, null)
})

test('dados do cliente não saem; o CEP sai', async () => {
  const v = await semearVenda({ lojaId: A1, vendedorId: VENDEDORA_A, dataVenda: '2026-02-10T17:00:00.000Z', cep: '30140999' })
  const { texto, corpo } = await chamar(periodo(DIA.fevereiro, DIA.fevereiro))
  for (const valor of Object.values(CLIENTE)) assert.equal(texto.includes(valor), false, `não pode sair: ${valor}`)
  assert.equal(deste(corpo.vendas).find(x => x.numero === v.numero)?.cepCliente, '30140999')
})

test('dois vendedores com o mesmo nome têm ids diferentes', async () => {
  const v1 = await semearVenda({ lojaId: A1, vendedorId: VENDEDORA_A, dataVenda: '2026-02-10T18:00:00.000Z' })
  const v2 = await semearVenda({ lojaId: A1, vendedorId: VENDEDORA_A2, dataVenda: '2026-02-10T18:00:00.000Z' })
  const { corpo } = await chamar(periodo(DIA.fevereiro, DIA.fevereiro))
  const d1 = deste(corpo.vendas).find(x => x.numero === v1.numero)
  const d2 = deste(corpo.vendas).find(x => x.numero === v2.numero)
  assert.equal(d1?.vendedor.nome, d2?.vendedor.nome)
  assert.notEqual(d1?.vendedor.id, d2?.vendedor.id)
})

test('dia de Brasília nos dois limites: 27/02 às 21:30 e 23:59 entram em 27/02; 28/02 às 00:00 só entra em 28/02', async () => {
  const noite = await semearVenda({ lojaId: A1, vendedorId: VENDEDORA_A, dataVenda: '2026-02-28T00:30:00.000Z' })
  const fimDoDia = await semearVenda({ lojaId: A1, vendedorId: VENDEDORA_A, dataVenda: '2026-02-28T02:59:30.000Z' })
  const inicioDoDia = await semearVenda({ lojaId: A1, vendedorId: VENDEDORA_A, dataVenda: '2026-02-28T03:00:00.000Z' })
  // Último microssegundo do dia: 23:59:59,999500 de Brasília. Entra em 27/02 mesmo passando do milissegundo do fim.
  const ultimoMicro = await semearVenda({ lojaId: A1, vendedorId: VENDEDORA_A, dataVenda: '2026-02-28T02:59:59.999500Z' })
  const dia27 = deste((await chamar(periodo(DIA.virada, DIA.virada))).corpo.vendas)
  const dia28 = deste((await chamar(periodo(DIA.viradaSeguinte, DIA.viradaSeguinte))).corpo.vendas)
  assert.ok(dia27.some(x => x.numero === noite.numero), '21:30 de 27/02 deveria entrar em 27/02')
  assert.ok(dia27.some(x => x.numero === fimDoDia.numero), '23:59 de 27/02 deveria entrar em 27/02')
  assert.ok(dia27.some(x => x.numero === ultimoMicro.numero), 'o último microssegundo de 27/02 deveria entrar em 27/02')
  assert.equal(dia27.some(x => x.numero === inicioDoDia.numero), false)
  assert.ok(dia28.some(x => x.numero === inicioDoDia.numero), '00:00 de 28/02 deveria entrar em 28/02')
  assert.equal(dia28.some(x => x.numero === fimDoDia.numero), false)
})

test('nota de produção viva e com número sai; de homologação não sai', async () => {
  const comProducao = await semearVenda({ lojaId: A1, vendedorId: VENDEDORA_A, dataVenda: '2026-02-10T19:00:00.000Z' })
  await semearNf(comProducao.id, A.grupoId, comProducao.numero, 'Producao', 'Autorizada', '78')
  const soHomologacao = await semearVenda({ lojaId: A1, vendedorId: VENDEDORA_A, dataVenda: '2026-02-10T19:00:00.000Z' })
  await semearNf(soHomologacao.id, A.grupoId, soHomologacao.numero, 'Homologacao', 'Autorizada', '900')
  const { corpo } = await chamar(periodo(DIA.fevereiro, DIA.fevereiro))
  assert.equal(deste(corpo.vendas).find(x => x.numero === comProducao.numero)?.numeroNf, '78')
  assert.equal(deste(corpo.vendas).find(x => x.numero === soHomologacao.numero)?.numeroNf, null)
})

test('venda com uma nota de homologação viva e outra de produção: uma linha, com o número de produção', async () => {
  const v = await semearVenda({ lojaId: A1, vendedorId: VENDEDORA_A, dataVenda: '2026-02-10T20:00:00.000Z' })
  await semearNf(v.id, A.grupoId, v.numero, 'Homologacao', 'Autorizada', '901')
  await semearNf(v.id, A.grupoId, v.numero, 'Producao', 'Autorizada', '79')
  const { corpo } = await chamar(periodo(DIA.fevereiro, DIA.fevereiro))
  const linhas = deste(corpo.vendas).filter(x => x.numero === v.numero)
  assert.equal(linhas.length, 1)
  assert.equal(linhas[0].numeroNf, '79')
})

test('nota negada não dá número; nota viva (em envio, processando ou em cancelamento pedido) com número sai; produção sem número não dá', async () => {
  const negada = await semearVenda({ lojaId: A1, vendedorId: VENDEDORA_A, dataVenda: '2026-02-10T21:00:00.000Z' })
  await semearNf(negada.id, A.grupoId, negada.numero, 'Producao', 'Negada', '80')
  const enviando = await semearVenda({ lojaId: A1, vendedorId: VENDEDORA_A, dataVenda: '2026-02-10T21:00:00.000Z' })
  await semearNf(enviando.id, A.grupoId, enviando.numero, 'Producao', 'Enviando', '81')
  const processando = await semearVenda({ lojaId: A1, vendedorId: VENDEDORA_A, dataVenda: '2026-02-10T21:00:00.000Z' })
  await semearNf(processando.id, A.grupoId, processando.numero, 'Producao', 'Processando', '82')
  const cancelando = await semearVenda({ lojaId: A1, vendedorId: VENDEDORA_A, dataVenda: '2026-02-10T21:00:00.000Z' })
  await semearNf(cancelando.id, A.grupoId, cancelando.numero, 'Producao', 'CancelamentoSolicitado', '83')
  const semNumero = await semearVenda({ lojaId: A1, vendedorId: VENDEDORA_A, dataVenda: '2026-02-10T21:00:00.000Z' })
  await semearNf(semNumero.id, A.grupoId, semNumero.numero, 'Producao', 'Autorizada', null)
  const { corpo } = await chamar(periodo(DIA.fevereiro, DIA.fevereiro))
  assert.equal(deste(corpo.vendas).find(x => x.numero === negada.numero)?.numeroNf, null)
  assert.equal(deste(corpo.vendas).find(x => x.numero === enviando.numero)?.numeroNf, '81', 'nota em envio com número é viva (nf-viva.ts): o número sai')
  assert.equal(deste(corpo.vendas).find(x => x.numero === processando.numero)?.numeroNf, '82', 'nota em processamento com número é viva: o número sai')
  assert.equal(deste(corpo.vendas).find(x => x.numero === cancelando.numero)?.numeroNf, '83', 'nota em cancelamento pedido é viva: o número sai')
  assert.equal(deste(corpo.vendas).find(x => x.numero === semNumero.numero)?.numeroNf, null)
})

test('venda cancelada pelo fluxo real some na consulta seguinte', async () => {
  const v = await semearVenda({ lojaId: A1, vendedorId: VENDEDORA_A, dataVenda: '2026-02-10T22:00:00.000Z' })
  const antes = await chamar(periodo(DIA.fevereiro, DIA.fevereiro))
  assert.ok(deste(antes.corpo.vendas).some(x => x.numero === v.numero), 'controle: a venda deveria sair antes de cancelar')
  usuario = { id: VENDEDORA_A, papel: 'aux_adm', lojaId: A1, contaId: A.contaId, gruposAcesso: [] }
  const r = await cancelarVendaCompletaAction(v.id, 'Motivo sintético do teste')
  assert.equal(r.ok, true)
  const depois = await chamar(periodo(DIA.fevereiro, DIA.fevereiro))
  assert.equal(deste(depois.corpo.vendas).some(x => x.numero === v.numero), false)
})

test('painel e API dão o mesmo número de motos e o mesmo valor, nas lojas que as duas regras têm', async () => {
  const lojasDasDuas = [A1, B1]
  const painel = (await vendasDoPainel(DIA.fevereiro, DIA.fevereiro)).filter(v => lojasDasDuas.includes(v.lojaId))
  const api = deste((await chamar(periodo(DIA.fevereiro, DIA.fevereiro))).corpo.vendas).filter(v => lojasDasDuas.includes(v.loja.id))
  assert.ok(painel.length > 0, 'controle: deveria haver vendas no dia')
  assert.equal(api.length, painel.length)
  assert.equal(api.reduce((s, v) => s + v.valor, 0), painel.reduce((s, v) => s + v.valor, 0))
})

test('período fora da regra: 400 com a lista fixa de erro, sem eco do valor', async () => {
  const { status, corpo, texto } = await chamar(periodo('lixo-323', DIA.fevereiro))
  assert.equal(status, 400)
  assert.deepEqual(corpo, { codigo: 'parametro_invalido', frase: 'Parâmetro inválido.' })
  assert.equal(texto.includes('lixo-323'), false)
})

test('período de 93 dias, ou sem o fim, é recusado com 400', async () => {
  assert.equal((await chamar(periodo('2026-02-01', '2026-05-04'))).status, 400)
  assert.equal((await chamar('?de=2026-02-01')).status, 400)
})

test('cursor adulterado, ou que cai fora do período pedido, é recusado com 400', async () => {
  const adulterado = await chamar(`${periodo(DIA.fevereiro, DIA.fevereiro)}&cursor=nao-e-cursor`)
  assert.equal(adulterado.status, 400)
  const outroDia = Buffer.from(JSON.stringify({ d: '2026-03-10T12:00:00.000Z', n: 1 })).toString('base64url')
  const deOutroPeriodo = await chamar(`${periodo(DIA.fevereiro, DIA.fevereiro)}&cursor=${outroDia}`)
  assert.equal(deOutroPeriodo.status, 400)
})

test('sem chave: 401 com o mesmo corpo de acesso negado; a chamada é registrada', async () => {
  const semChave = await chamar(periodo(DIA.fevereiro, DIA.fevereiro), null)
  assert.equal(semChave.status, 401)
  assert.deepEqual(semChave.corpo, { codigo: 'acesso_negado', frase: 'Acesso negado.' })
  const errada = await chamar(periodo(DIA.fevereiro, DIA.fevereiro), 'chave-que-nao-existe-323')
  assert.equal(errada.status, 401)
  assert.equal(errada.texto, semChave.texto)
})

test('registro de acesso: período e linhas quando deu certo; sem período quando a chamada foi recusada', async () => {
  const ok = await chamar(periodo(DIA.fevereiro, DIA.fevereiro))
  const recusada = await chamar(periodo('lixo-323', DIA.fevereiro))
  await esperarRegistros()
  const [registroOk] = await execRows(sql`select endpoint, status, periodo_ini, periodo_fim, linhas from api_acessos where user_agent = ${ok.ua}`)
  assert.equal(registroOk.endpoint, ENDPOINT)
  assert.equal(registroOk.status, 200)
  assert.equal(registroOk.periodo_ini, DIA.fevereiro)
  assert.equal(registroOk.periodo_fim, DIA.fevereiro)
  assert.equal(registroOk.linhas, ok.corpo.vendas?.length)
  const [registroRecusada] = await execRows(sql`select status, periodo_ini, linhas from api_acessos where user_agent = ${recusada.ua}`)
  assert.equal(registroRecusada.status, 400)
  assert.equal(registroRecusada.periodo_ini, null)
  assert.equal(registroRecusada.linhas, null)
})

// Paginação: os dias de 500 e de 501 vendas são só deste teste, para a página ter tamanho previsível.
async function semearDia(dia: string, quantidade: number, horaUtc: string) {
  const ids: VendaSemeada[] = []
  for (let i = 0; i < quantidade; i++) ids.push(await semearVenda({ lojaId: A1, vendedorId: VENDEDORA_A, dataVenda: `${dia}T${horaUtc}` }))
  return ids
}

// Segue o cursor a partir de `cursor` até a última página (sem limite de página; o teto é de segurança).
async function seguirPaginas(query: string, cursor: string | null): Promise<Venda[][]> {
  const paginas: Venda[][] = []
  let atual = cursor
  for (let i = 0; i < 20; i++) {
    const { corpo } = await chamar(`${query}${atual ? `&cursor=${atual}` : ''}`)
    paginas.push(corpo.vendas ?? [])
    atual = corpo.proximaPagina ?? null
    if (atual === null) break
  }
  return paginas
}

const caminharPaginas = (query: string) => seguirPaginas(query, null)

test('página de 500 vendas: sem próxima página', async () => {
  await semearDia('2026-01-20', 500, '15:00:00.000Z')
  const { corpo } = await chamar(periodo('2026-01-20', '2026-01-20'))
  assert.equal(corpo.vendas?.length, 500)
  assert.equal(corpo.proximaPagina, null)
})

test('página de 501 vendas: 500 com cursor, e a 501ª na página seguinte; a venda cancelada e a nova somem ou entram certo', async () => {
  const dia = DIA.janeiro
  const vendas = await semearDia(dia, 501, '15:00:00.123456Z')
  const query = periodo(dia, dia)
  const primeira = await chamar(query)
  assert.equal(primeira.corpo.vendas?.length, 500)
  assert.ok(primeira.corpo.proximaPagina, 'a 1ª página deveria trazer o cursor')
  // Entre as páginas: uma venda com data anterior ao cursor (não aparece), outra com data depois (aparece),
  // e a 501ª (a de número maior) é cancelada pelo fluxo real (não aparece).
  const cancelada = vendas[vendas.length - 1]
  const anterior = await semearVenda({ lojaId: A1, vendedorId: VENDEDORA_A, dataVenda: `${dia}T11:00:00.000Z` })
  const posterior = await semearVenda({ lojaId: A1, vendedorId: VENDEDORA_A, dataVenda: `${dia}T23:00:00.000Z` })
  usuario = { id: VENDEDORA_A, papel: 'aux_adm', lojaId: A1, contaId: A.contaId, gruposAcesso: [] }
  assert.equal((await cancelarVendaCompletaAction(cancelada.id, 'Motivo sintético do teste')).ok, true)

  const paginas = [primeira.corpo.vendas ?? [], ...(await seguirPaginas(query, primeira.corpo.proximaPagina ?? null))]
  const todas = paginas.flat().filter(x => lojaIds.includes(x.loja.id)).map(x => x.numero)
  assert.equal(new Set(todas).size, todas.length, 'nenhuma venda pode repetir entre páginas')
  assert.equal(todas.includes(cancelada.numero), false, 'a venda cancelada não sai')
  assert.equal(todas.includes(anterior.numero), false, 'venda com data antes do cursor não entra nesta passada')
  assert.equal(todas.includes(posterior.numero), true, 'venda com data depois do cursor sai na passada seguinte')
  const originaisQueSobram = vendas.filter(v => v.id !== cancelada.id).map(v => v.numero)
  for (const numero of originaisQueSobram) {
    const estaNaPrimeira = (primeira.corpo.vendas ?? []).some(x => x.numero === numero)
    const estaNasSeguintes = todas.includes(numero)
    assert.equal(estaNaPrimeira || estaNasSeguintes, true, `a venda ${numero} não pode se perder`)
  }
})

test('passada completa do dia de 501 vendas: mais de uma página e nenhuma venda repetida', async () => {
  const paginas = await caminharPaginas(periodo(DIA.janeiro, DIA.janeiro))
  const numeros = paginas.flat().filter(x => lojaIds.includes(x.loja.id)).map(x => x.numero)
  assert.equal(new Set(numeros).size, numeros.length)
  assert.ok(paginas.length >= 2, 'controle: 501 vendas no dia deveriam dar duas páginas')
})
