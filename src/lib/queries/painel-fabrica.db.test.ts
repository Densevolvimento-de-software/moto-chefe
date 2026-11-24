// Teste de banco: roda contra o Postgres descartável do CI (job `banco` do ci.yml).
// Como montar local: ver o cabeçalho de src/lib/pedido-venda.db.test.ts.
// As consultas usam o db global (sem transação): os dados são gravados de verdade e
// apagados no after. Toda conferência filtra pelas lojas deste teste (os arquivos do
// test:db rodam em paralelo no mesmo banco).
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { sql } from 'drizzle-orm'

const url = process.env.TEST_DATABASE_URL
if (!url) throw new Error('TEST_DATABASE_URL não definida — este teste só roda num Postgres descartável')
if (!['localhost', '127.0.0.1'].includes(new URL(url).hostname)) {
  throw new Error('TEST_DATABASE_URL precisa ser loopback (Postgres descartável)')
}
process.env.DATABASE_URL = url

type Db = typeof import('@/lib/db')
type Painel = typeof import('@/lib/queries/painel-fabrica')
type Certificado = typeof import('@/lib/queries/certificado-bateria')
type Vendas = typeof import('@/lib/queries/vendas')
type PainelPuro = typeof import('@/lib/painel-fabrica')
let db: Db['db']
let execRows: Db['execRows']
let painel: Painel
let certificado: Certificado
let vendasQ: Vendas
let ehLojaDoPainel: PainelPuro['ehLojaDoPainel']

// a: Conta A, loja MotoChefe · b: Conta B, loja MotoChefe · semPortal: Conta A, sem login da
// fábrica · desativada: Conta C desativada, com login · inativa: Conta A, loja inativa.
type Chave = 'a' | 'b' | 'semPortal' | 'desativada' | 'inativa'
const lojas = {} as Record<Chave, string>
const contas: string[] = []
const modelos = { mc: '', voi: '' }
const CNPJS = ['00000000081901', '00000000081902', '00000000081903']
let numeros = { a15: 0, a31: 0, b20: 0, a01nov: 0, a15jul: 0 }
let chassis = { a15: '', a31: '', b20: '' }
// Ids das vendas do certificado de bateria (#235): as da regra e as de fora dela, uma por motivo.
const vendaId = {} as Record<'a15' | 'b20' | 'voi' | 'semPortal' | 'inativa' | 'desativada', string>

const linha = async (q: ReturnType<typeof sql>) => (await execRows(q))[0] as { id: string }
const nossas = <T extends { lojaId: string }>(l: T[]) => l.filter(x => Object.values(lojas).includes(x.lojaId))

before(async () => {
  ;({ db, execRows } = await import('@/lib/db'))
  painel = await import('@/lib/queries/painel-fabrica')
  certificado = await import('@/lib/queries/certificado-bateria')
  vendasQ = await import('@/lib/queries/vendas')
  ;({ ehLojaDoPainel } = await import('@/lib/painel-fabrica'))

  modelos.mc = (await linha(sql`insert into modelos (marca, modelo, categoria, potencia_w, motor, velocidade_max) values ('MotoChefe', ' x819 ', 'autopropelido', '1000', '', '') returning id`)).id
  modelos.voi = (await linha(sql`insert into modelos (marca, modelo, categoria, potencia_w, motor, velocidade_max) values ('Voi', 'VOI819', 'autopropelido', '1000', '', '') returning id`)).id

  const grupoNovo = async (nome: string, cnpj: string, desativada = false) => {
    const conta = await linha(sql`insert into contas (nome, desativada_em) values (${nome}, ${desativada ? sql`now()` : null}) returning id`)
    contas.push(conta.id)
    return (await linha(sql`insert into grupos (nome, cnpj, conta_id) values (${nome}, ${cnpj}, ${conta.id}) returning id`)).id
  }
  const gA = await grupoNovo('Painel 819 A', CNPJS[0])
  const gB = await grupoNovo('Painel 819 B', CNPJS[1])
  const gC = await grupoNovo('Painel 819 C', CNPJS[2], true)
  const lojaNova = async (nome: string, grupo: string, portal: string | null, ativa = true) =>
    (await linha(sql`insert into lojas (nome, cidade, endereco, grupo_id, fabrica_email, ativa) values (${nome}, 'C', 'R', ${grupo}, ${portal}, ${ativa}) returning id`)).id
  lojas.a = await lojaNova('Loja 819 A', gA, 'a819@teste.invalid')
  lojas.b = await lojaNova('Loja 819 B', gB, 'b819@teste.invalid')
  lojas.semPortal = await lojaNova('Loja 819 Sem Portal', gA, '  ')
  lojas.desativada = await lojaNova('Loja 819 Desativada', gC, 'c819@teste.invalid')
  lojas.inativa = await lojaNova('Loja 819 Inativa', gA, 'i819@teste.invalid', false)

  // Moto arquivada exige quem arquivou e o motivo (check motos_arquivo_completo, 0174).
  const arquivador = (await linha(sql`insert into usuarios (id, nome, email, papel, loja_id) values (gen_random_uuid(), 'Arq 819', 'vend819-arq@teste.invalid', 'aux_adm', ${lojas.a}) returning id`)).id
  let seq = 0
  const moto = async (loja: string, modelo: string, cor: string, extra: { vendida?: boolean; arquivada?: boolean; garantia?: boolean } = {}) =>
    (await linha(sql`insert into motos (chassi, modelo_id, loja_id, cor, nota_fiscal_entrada, status, disponibilidade, arquivada_em, arquivada_por, motivo_arquivo, somente_garantia)
      values (${'PAINEL819' + seq++}, ${modelo}, ${loja}, ${cor}, '1', ${extra.vendida ? 'vendida' : 'disponivel'},
              ${extra.vendida ? 'vendida' : 'disponivel'},
              ${extra.arquivada ? sql`now()` : null}, ${extra.arquivada ? arquivador : null}, ${extra.arquivada ? 'teste 819' : null},
              ${extra.garantia ?? false}) returning id`)).id

  // Estoque: A tem 2 PRETO + 1 branco (grafia solta) da MotoChefe e 3 Voi; B tem 1 PRETO.
  await moto(lojas.a, modelos.mc, 'PRETO')
  await moto(lojas.a, modelos.mc, 'PRETO')
  await moto(lojas.a, modelos.mc, ' branco ')
  for (let i = 0; i < 3; i++) await moto(lojas.a, modelos.voi, 'PRETO')
  await moto(lojas.b, modelos.mc, 'PRETO')
  // Fora do estoque: arquivada, só garantia, e lojas que não são do painel.
  await moto(lojas.a, modelos.mc, 'PRETO', { arquivada: true })
  await moto(lojas.a, modelos.mc, 'PRETO', { garantia: true })
  for (const l of [lojas.semPortal, lojas.desativada, lojas.inativa]) await moto(l, modelos.mc, 'PRETO')

  // Vendas: em 15/10 (dentro), uma Voi (fora pela marca), uma em 01/11 00:30 de Brasília
  // (fora do período de outubro) e uma em cada loja fora do painel.
  const vender = async (loja: string, modelo: string, quando: string, valor = 1000) => {
    const chassi = 'PAINEL819' + seq
    const motoId = await moto(loja, modelo, 'PRETO', { vendida: true })
    const vendedor = await linha(sql`insert into usuarios (id, nome, email, papel, loja_id) values (gen_random_uuid(), 'Vend 819', ${'vend819-' + seq + '@teste.invalid'}, 'vendedor', ${loja}) returning id`)
    const pedido = await linha(sql`insert into pedidos_venda (moto_id, loja_id, vendedor_id) values (${motoId}, ${loja}, ${vendedor.id}) returning id`)
    await db.execute(sql`insert into vendas (pedido_venda_id, moto_id, loja_id, vendedor_id, efetivado_por, cliente_nome, cliente_cpf, valor, forma_pagamento, data_venda)
      values (${pedido.id}, ${motoId}, ${loja}, ${vendedor.id}, ${vendedor.id}, 'Cliente', '52998224725', ${valor}, 'pix', ${quando}::timestamptz)`)
    // O número da venda sai do pedido (trigger do banco), não do insert: lê o que ficou gravado.
    const [gravada] = await execRows(sql`select id, numero from vendas where moto_id = ${motoId}`) as { id: string; numero: number }[]
    return { id: gravada.id, numero: gravada.numero, chassi }
  }
  // Valores distintos, com centavos: cada venda tem de trazer o seu.
  const a15 = await vender(lojas.a, modelos.mc, '2026-10-15T15:00:00Z', 13490.5)
  const a31 = await vender(lojas.a, modelos.mc, '2026-10-31T23:00:00Z', 9990) // 20h de 31/10 em Brasília: dentro
  const b20 = await vender(lojas.b, modelos.mc, '2026-10-20T15:00:00Z', 16900.25)
  vendaId.voi = (await vender(lojas.a, modelos.voi, '2026-10-15T15:00:00Z')).id
  const a01nov = await vender(lojas.a, modelos.mc, '2026-11-01T03:30:00Z') // 00:30 de 01/11 em Brasília: fora
  // 15/07: mais de 92 dias antes de 31/10, fora do teto da aba Vendas (#901).
  const a15jul = await vender(lojas.a, modelos.mc, '2026-07-15T15:00:00Z')
  numeros = { a15: a15.numero, a31: a31.numero, b20: b20.numero, a01nov: a01nov.numero, a15jul: a15jul.numero }
  chassis = { a15: a15.chassi, a31: a31.chassi, b20: b20.chassi }
  vendaId.a15 = a15.id
  vendaId.b20 = b20.id
  // Fora pela loja: sem portal, inativa e de Conta desativada.
  for (const l of ['semPortal', 'inativa', 'desativada'] as const) vendaId[l] = (await vender(lojas[l], modelos.mc, '2026-10-15T15:00:00Z')).id
})

after(async () => {
  const ids = sql.join(Object.values(lojas).map(i => sql`${i}`), sql`, `)
  await db.execute(sql`delete from vendas where loja_id in (${ids})`)
  await db.execute(sql`delete from pedidos_venda where loja_id in (${ids})`)
  await db.execute(sql`delete from motos where loja_id in (${ids})`)
  await db.execute(sql`delete from usuarios where email like 'vend819-%@teste.invalid'`)
  await db.execute(sql`delete from modelos where id in (${modelos.mc}, ${modelos.voi})`)
  await db.execute(sql`delete from lojas where id in (${ids})`)
  await db.execute(sql`delete from grupos where cnpj in (${sql.join(CNPJS.map(c => sql`${c}`), sql`, `)})`)
  await db.execute(sql`delete from contas where id in (${sql.join(contas.map(i => sql`${i}`), sql`, `)})`)
  await (globalThis as { __pgPool?: { end(): Promise<void> } }).__pgPool?.end()
})

test('lojas do painel: as duas Contas com portal; sem portal, inativa e de Conta desativada ficam fora', async () => {
  const ids = nossas(await painel.listarLojasDoPainel()).map(l => l.lojaId).sort()
  assert.deepEqual(ids, [lojas.a, lojas.b].sort())
})

test('lojas do painel: só o id e o nome, sem cidade nem nome do grupo', async () => {
  const l = nossas(await painel.listarLojasDoPainel())
  assert.equal(l.length, 2)
  for (const loja of l) assert.deepEqual(Object.keys(loja).sort(), ['lojaId', 'lojaNome'])
})

test('estoque: só MotoChefe no showroom, somado por loja × modelo × cor; a Voi não aparece', async () => {
  const e = nossas(await painel.estoqueDoPainel())
    .map(l => [l.lojaId === lojas.a ? 'a' : 'b', l.modelo, l.cor, l.quantidade])
    .sort((x, y) => String(x).localeCompare(String(y)))
  assert.deepEqual(e, [['a', 'X819', 'BRANCO', 1], ['a', 'X819', 'PRETO', 2], ['b', 'X819', 'PRETO', 1]])
  assert.ok(!e.some(l => l[1] === 'VOI819'), 'Voi nunca entra')
})

test('vendas: uma linha por venda, com número, cor e chassi; dias de Brasília, só MotoChefe e só lojas do painel', async () => {
  const v = nossas(await painel.vendasDoPainel('2026-10-01', '2026-10-31'))
    .map(l => [l.lojaId === lojas.a ? 'a' : 'b', l.numero, l.data, l.modelo, l.cor, l.chassi])
    .sort((x, y) => Number(x[1]) - Number(y[1]))
  assert.deepEqual(v, [
    ['a', numeros.a15, '2026-10-15T15:00:00.000Z', 'X819', 'PRETO', chassis.a15],
    ['a', numeros.a31, '2026-10-31T23:00:00.000Z', 'X819', 'PRETO', chassis.a31],
    ['b', numeros.b20, '2026-10-20T15:00:00.000Z', 'X819', 'PRETO', chassis.b20],
  ])
  const nov = nossas(await painel.vendasDoPainel('2026-11-01', '2026-11-01'))
  assert.deepEqual(nov.map(l => l.numero), [numeros.a01nov])
})

test('vendas: cada linha leva só data, número, loja, modelo, cor, chassi e valor da moto (sem id da venda nem cliente)', async () => {
  // O valor da moto entra pela decisão do Luis de 17/11 (#30), que revê a I1.
  const v = nossas(await painel.vendasDoPainel('2026-10-01', '2026-10-31'))
  assert.equal(v.length, 3)
  for (const l of v) assert.deepEqual(Object.keys(l).sort(), ['chassi', 'cor', 'data', 'lojaId', 'modelo', 'numero', 'valor'])
})

test('vendas: cada venda traz o valor da moto gravado na venda, como número em reais', async () => {
  const v = nossas(await painel.vendasDoPainel('2026-10-01', '2026-10-31'))
  const porNumero = Object.fromEntries(v.map(l => [l.numero, l.valor]))
  assert.deepEqual(porNumero, { [numeros.a15]: 13490.5, [numeros.a31]: 9990, [numeros.b20]: 16900.25 })
})

test('período maior que 92 dias: o servidor corta o início e a venda antiga não vem (#901)', async () => {
  const p = await painel.carregarPainelFabrica('2020-01-01', '2026-10-31')
  assert.deepEqual([p.de, p.ate, p.limitado], ['2026-08-01', '2026-10-31', true])
  const vendidas = nossas(p.vendas).map(v => v.numero).sort((x, y) => x - y)
  assert.deepEqual(vendidas, [numeros.a15, numeros.b20, numeros.a31].sort((x, y) => x - y))
  assert.ok(!vendidas.includes(numeros.a15jul))
})

// ─── Certificado de bateria (#235): a mesma regra do painel, mais o acesso por Conta ─────────────

test('certificado: só a venda de moto MotoChefe em loja do painel, nas duas Contas; Voi, sem portal, inativa e Conta desativada ficam fora', async () => {
  const todas = Object.values(vendaId)
  const com = await certificado.vendasComCertificadoBateria(todas)
  assert.deepEqual([...com].sort(), [vendaId.a15, vendaId.b20].sort())
})

test('certificado: sem ids, nenhum certificado (e nenhuma consulta quebrada)', async () => {
  assert.equal((await certificado.vendasComCertificadoBateria([])).size, 0)
})

test('regra de loja em TS bate com a SQL do painel, loja a loja (#235)', async () => {
  const noPainel = new Set(nossas(await painel.listarLojasDoPainel()).map(l => l.lojaId))
  for (const [chave, id] of Object.entries(lojas)) {
    const [l] = await execRows(sql`
      select l.ativa, l.fabrica_email, g.ativo as grupo_ativo, c.desativada_em
      from lojas l join grupos g on g.id = l.grupo_id join contas c on c.id = g.conta_id where l.id = ${id}`) as
      { ativa: boolean; fabrica_email: string | null; grupo_ativo: boolean; desativada_em: Date | null }[]
    const pura = ehLojaDoPainel({ ativa: l.ativa, fabricaEmail: l.fabrica_email, grupoAtivo: l.grupo_ativo, contaDesativadaEm: l.desativada_em })
    assert.equal(pura, noPainel.has(id), chave)
  }
})

const aux = (lojaId: string, contaId: string) => ({ papel: 'aux_adm', lojaId, gruposAcesso: [], contaId }) as const

test('certificado: a loja da venda abre; venda fora da regra não abre (null)', async () => {
  const contaA = contas[0]
  const aberta = await vendasQ.buscarVendaDoCertificado(vendaId.a15, aux(lojas.a, contaA))
  assert.equal(aberta?.id, vendaId.a15)
  assert.equal(await vendasQ.buscarVendaDoCertificado(vendaId.voi, aux(lojas.a, contaA)), null, 'moto Voi')
  assert.equal(await vendasQ.buscarVendaDoCertificado(vendaId.semPortal, aux(lojas.semPortal, contaA)), null, 'loja sem portal')
  assert.equal(await vendasQ.buscarVendaDoCertificado(vendaId.inativa, aux(lojas.inativa, contaA)), null, 'loja inativa')
})

test('certificado: a Conta B não abre venda da Conta A, e a resposta é a mesma de fora da regra e de id inexistente', async () => {
  const [contaA, contaB] = contas
  const deB = aux(lojas.b, contaB)
  const socioB = { papel: 'admin_socio', lojaId: lojas.b, gruposAcesso: [], contaId: contaB } as const
  const naoExiste = '00000000-0000-0000-0000-000000000000'
  for (const u of [deB, socioB]) {
    const respostas = await Promise.all([vendaId.a15, vendaId.voi, naoExiste].map(id => vendasQ.buscarVendaDoCertificado(id, u)))
    assert.deepEqual(respostas, [null, null, null])
  }
  // E a Conta A também não abre a da B.
  assert.equal(await vendasQ.buscarVendaDoCertificado(vendaId.b20, aux(lojas.a, contaA)), null)
  assert.equal((await vendasQ.buscarVendaDoCertificado(vendaId.b20, deB))?.id, vendaId.b20)
})

test('certificado: sócio abre venda MotoChefe do grupo que vê e não a de outra loja fora da regra', async () => {
  const socioA = { papel: 'admin_socio', lojaId: lojas.a, gruposAcesso: [], contaId: contas[0] } as const
  assert.equal((await vendasQ.buscarVendaDoCertificado(vendaId.a15, socioA))?.id, vendaId.a15)
  assert.equal(await vendasQ.buscarVendaDoCertificado(vendaId.voi, socioA), null)
})

test('lista de vendas: cada linha diz se tem certificado, e o e-mail da fábrica da loja não vai junto', async () => {
  const lista = await vendasQ.listarVendas({ lojaId: Object.values(lojas), dataInicio: '2026-10-01', dataFim: '2026-10-31' })
  const flag = new Map(lista.map(v => [v.id, v.certificadoBateria]))
  for (const chave of ['a15', 'b20'] as const) assert.equal(flag.get(vendaId[chave]), true, chave)
  for (const chave of ['voi', 'semPortal', 'inativa', 'desativada'] as const) assert.equal(flag.get(vendaId[chave]), false, chave)
  assert.ok(!JSON.stringify(lista).includes('fabrica'), 'nada do portal da fábrica na linha')
})
