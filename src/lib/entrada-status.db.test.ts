// Teste de banco: Postgres descartável. Status na entrada (#10): as Server Actions da Entrada chamadas
// direto, como faria quem abre o DevTools. Os três caminhos (manual, XML/planilha, nota com peças)
// gravam a moto e o histórico com o status escolhido para o lançamento; ausente vale Caixa; valor fora
// de caixa/em_transporte recusa sem gravar nada; campo a mais dentro da moto não muda loja, status nem
// disponibilidade; a Conta B, com a loja da Conta A, recebe a frase da loja inexistente e nada grava.
// Fronteira de fora mockada: sessão e next/cache.
import { after, before, mock, test } from 'node:test'
import assert from 'node:assert/strict'
import { sql } from 'drizzle-orm'
import { semearContaBase, semearUsuario } from '@/test/semear-conta'

const url = process.env.TEST_DATABASE_URL
if (!url) throw new Error('TEST_DATABASE_URL não definida — este teste só roda num Postgres descartável')
if (!['localhost', '127.0.0.1'].includes(new URL(url).hostname)) {
  throw new Error('TEST_DATABASE_URL precisa ser loopback (Postgres descartável)')
}
process.env.DATABASE_URL = url

const P = 'EST10'
let usuarioDaSessao: Record<string, unknown> = {}

type Db = typeof import('@/lib/db')
let db: Db['db']
const mocks = [
  mock.module('@/lib/auth', { namedExports: { getUsuarioLogado: async () => usuarioDaSessao } }),
  mock.module('next/cache', { namedExports: { revalidatePath: () => {} } }),
]

type Sessao = Record<string, unknown>
const sessoes = { socioA: {} as Sessao, socioB: {} as Sessao }
const semente = { contaA: '', grupoA: '', lojaA: '', contaB: '', grupoB: '', lojaB: '', modeloId: '', pecaId: '' }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const linhas = async (q: ReturnType<typeof sql>) => ((await db.execute(q)) as unknown as { rows: any[] }).rows

before(async () => {
  ;({ db } = await import('@/lib/db'))
  const a = await semearContaBase(db, { prefixo: P, nome: 'A', cnpj: '00000000001001' })
  const b = await semearContaBase(db, { prefixo: P, nome: 'B', cnpj: '00000000001002' })
  const socioA = await semearUsuario(db, a, { papel: 'admin_socio', rotulo: 'socio', semLoja: true, comGrupo: true })
  const socioB = await semearUsuario(db, b, { papel: 'admin_socio', rotulo: 'socio', semLoja: true, comGrupo: true })
  const [modelo] = await linhas(sql`insert into modelos (marca, modelo, categoria, potencia_w, motor, velocidade_max, conta_id)
    values ('M', ${P}, 'autopropelido', '1000', 'hub', '32', ${a.contaId}) returning id`)
  const [peca] = await linhas(sql`insert into pecas_catalogo (nome, valor, conta_id) values (${'Capacete ' + P}, '90', ${a.contaId}) returning id`)
  Object.assign(semente, {
    contaA: a.contaId, grupoA: a.grupoId, lojaA: a.lojaId, contaB: b.contaId, grupoB: b.grupoId, lojaB: b.lojaId,
    modeloId: modelo.id, pecaId: peca.id,
  })
  sessoes.socioA = { id: socioA, papel: 'admin_socio', lojaId: null, gruposAcesso: [a.grupoId], contaId: a.contaId, grupoLiberado: null }
  sessoes.socioB = { id: socioB, papel: 'admin_socio', lojaId: null, gruposAcesso: [b.grupoId], contaId: b.contaId, grupoLiberado: null }
})

after(async () => {
  const daSemente = sql`(select id from motos where chassi like ${P + '%'})`
  for (const t of ['historico_estoque', 'motos_fiscal']) await db.execute(sql`delete from ${sql.raw(t)} where moto_id in ${daSemente}`)
  await db.execute(sql`delete from motos where chassi like ${P + '%'}`)
  for (const conta of [semente.contaA, semente.contaB]) {
    for (const t of ['notas_entrada', 'pecas_vinculo_fornecedor']) await db.execute(sql`delete from ${sql.raw(t)} where conta_id = ${conta}`)
  }
  await db.execute(sql`delete from pecas_estoque_loja where loja_id in (${semente.lojaA}, ${semente.lojaB})`)
  await db.execute(sql`delete from pecas_catalogo where conta_id = ${semente.contaA}`)
  await db.execute(sql`delete from modelos where modelo = ${P}`)
  await db.execute(sql`delete from usuarios where email like ${'%-' + P.toLowerCase() + '-%'}`)
  for (const grupo of [semente.grupoA, semente.grupoB]) {
    await db.execute(sql`delete from precificacao where grupo_id = ${grupo}`)
    await db.execute(sql`delete from lojas where grupo_id = ${grupo}`)
    await db.execute(sql`delete from grupos where id = ${grupo}`)
  }
  for (const conta of [semente.contaA, semente.contaB]) await db.execute(sql`delete from contas where id = ${conta}`)
  for (const m of mocks) m.restore()
  await (globalThis as { __pgPool?: { end(): Promise<void> } }).__pgPool?.end()
})

type Entrada = typeof import('@/app/(dashboard)/entrada/actions')
const entrada = () => import('@/app/(dashboard)/entrada/actions') as Promise<Entrada>

// O pedido do navegador, com o status como valor qualquer: é o que o DevTools manda.
type Pedido = { statusNaEntrada?: unknown; lojaId?: string }
const motoDoLote = (chassi: string) => ({ chassi, cor: 'CINZA', motor: '', modeloId: semente.modeloId, precoCompra: '6400', notaFiscal: '1010' })
const NOTA = { chaveAcesso: '8'.repeat(44), numero: '1010', fornecedorCnpj: '12345678000199' }
const ficha = { codigo: 'GIGA', descricao: 'GIGA MOTO CHEFE', ncm: '87116000', cest: '2600100', cfopEntrada: '5405', unidade: 'UN', origem: '4', cstIcmsEntrada: '60', cstPis: '01', cstCofins: '01', classTribIbsCbs: '', tpPint: '', valorUnitario: '6400.00' }
const emitente = { cnpj: '12345678000199', nome: 'Fabrica ' + P, nfNumero: '1010', nfChave: NOTA.chaveAcesso }

async function lote(chassis: string[], p: Pedido = {}) {
  const { registrarEntradaLote } = await entrada()
  return registrarEntradaLote({
    lojaId: p.lojaId ?? semente.lojaA,
    motos: chassis.map(motoDoLote),
    fiscais: chassis.map(chassi => ({ chassi, emitente, ficha })),
    ...('statusNaEntrada' in p ? { statusNaEntrada: p.statusNaEntrada } : {}),
  } as Parameters<Entrada['registrarEntradaLote']>[0])
}

async function manual(chassis: string[], p: Pedido = {}) {
  const { registrarEntrada } = await entrada()
  return registrarEntrada({
    notaFiscal: '1010', modeloId: semente.modeloId, precoCompra: '6400', lojaId: p.lojaId ?? semente.lojaA,
    motos: chassis.map(chassi => ({ chassi, cor: 'PRETO', motor: '' })),
    ...('statusNaEntrada' in p ? { statusNaEntrada: p.statusNaEntrada } : {}),
  } as Parameters<Entrada['registrarEntrada']>[0])
}

async function nota(chassis: string[], p: Pedido = {}) {
  const { registrarEntradaNota } = await entrada()
  return registrarEntradaNota({
    lojaId: p.lojaId ?? semente.lojaA, nota: NOTA,
    motos: chassis.map(motoDoLote),
    pecas: [{ codigo: '26302', nomeXml: 'CAPACETE AZUL', quantidade: 3, custoUnitario: 32.61, pecaId: semente.pecaId }],
    ...('statusNaEntrada' in p ? { statusNaEntrada: p.statusNaEntrada } : {}),
  } as Parameters<Entrada['registrarEntradaNota']>[0])
}

/** Moto gravada e o status do histórico de entrada dela, por chassi. */
const motosGravadas = (chassis: string[]) => linhas(sql`
  select m.chassi, m.loja_id, m.status, m.disponibilidade,
    (select h.status_novo from historico_estoque h where h.moto_id = m.id and h.tipo = 'entrada') as historico
  from motos m where m.chassi in (${sql.join(chassis.map(c => sql`${c}`), sql`, `)}) order by m.chassi`)

const esperadas = (chassis: string[], status: string) =>
  chassis.map(chassi => ({ chassi, loja_id: semente.lojaA, status, disponibilidade: null, historico: status }))

const saldoDaPeca = async () =>
  (await linhas(sql`select coalesce(sum(quantidade), 0)::int as q from pecas_estoque_loja where peca_id = ${semente.pecaId}`))[0].q as number

test('lote (XML ou planilha) em transporte: moto e histórico em transporte, ficha fiscal gravada, frase diz o status', async () => {
  usuarioDaSessao = sessoes.socioA
  const chassis = [P + 'LOTE1', P + 'LOTE2']
  const r = await lote(chassis, { statusNaEntrada: 'em_transporte' })
  assert.equal(r.error, undefined)
  assert.match(r.success ?? '', /^2 moto\(s\) inserida\(s\) como Em transporte/)
  assert.deepEqual(await motosGravadas(chassis), esperadas(chassis, 'em_transporte'))
  const fichas = await linhas(sql`select count(*)::int as n from motos_fiscal f join motos m on m.id = f.moto_id where m.chassi in (${chassis[0]}, ${chassis[1]})`)
  assert.equal(fichas[0].n, 2)
})

test('manual em transporte: moto e histórico em transporte, frase diz o status', async () => {
  usuarioDaSessao = sessoes.socioA
  const chassis = [P + 'MAN1']
  const r = await manual(chassis, { statusNaEntrada: 'em_transporte' })
  assert.match(r.success ?? '', /^1 moto\(s\) inserida\(s\) como Em transporte/)
  assert.deepEqual(await motosGravadas(chassis), esperadas(chassis, 'em_transporte'))
})

test('nota com peças em transporte: motos em transporte e as peças entram no estoque', async () => {
  usuarioDaSessao = sessoes.socioA
  const chassis = [P + 'NOTA1']
  const antes = await saldoDaPeca()
  const r = await nota(chassis, { statusNaEntrada: 'em_transporte' })
  assert.equal(r.error, undefined)
  assert.match(r.success ?? '', /como Em transporte/)
  assert.deepEqual(await motosGravadas(chassis), esperadas(chassis, 'em_transporte'))
  assert.equal(await saldoDaPeca(), antes + 3)
})

test('Caixa marcado ou campo ausente: grava Caixa, e a frase não fala de status', async () => {
  usuarioDaSessao = sessoes.socioA
  const r = [
    await lote([P + 'CX1'], { statusNaEntrada: 'caixa' }),
    await manual([P + 'CX2']),
    await nota([P + 'CX3']),
  ]
  for (const resposta of r) {
    assert.equal(resposta.error, undefined)
    assert.doesNotMatch(resposta.success ?? '', /como/)
  }
  assert.deepEqual(await motosGravadas([P + 'CX1', P + 'CX2', P + 'CX3']), esperadas([P + 'CX1', P + 'CX2', P + 'CX3'], 'caixa'))
})

test('status forjado fora de caixa/em_transporte: os três caminhos recusam e nada é gravado', async () => {
  usuarioDaSessao = sessoes.socioA
  const antes = await saldoDaPeca()
  for (const forjado of ['vendida', 'montada', 'xyz', null]) {
    const chassi = `${P}FJ${String(forjado).toUpperCase()}`
    for (const caminho of [lote, manual, nota]) {
      assert.deepEqual(await caminho([chassi], { statusNaEntrada: forjado }), { error: 'Status na entrada inválido' }, `${caminho.name} ${forjado}`)
    }
    assert.deepEqual(await motosGravadas([chassi]), [])
  }
  assert.equal(await saldoDaPeca(), antes)
})

test('campos a mais dentro da moto (status, loja, disponibilidade) não valem: grava pela loja e pelo status do pedido', async () => {
  usuarioDaSessao = sessoes.socioA
  const chassi = P + 'MAIS1'
  const { registrarEntradaLote } = await entrada()
  const motoForjada = { ...motoDoLote(chassi), status: 'vendida', lojaId: semente.lojaB, disponibilidade: 'disponivel', grupoEntradaId: semente.grupoB }
  const r = await registrarEntradaLote({ lojaId: semente.lojaA, motos: [motoForjada], statusNaEntrada: 'em_transporte' } as Parameters<Entrada['registrarEntradaLote']>[0])
  assert.equal(r.error, undefined)
  assert.deepEqual(await motosGravadas([chassi]), esperadas([chassi], 'em_transporte'))
})

test('Conta B com a loja da Conta A: mesma resposta da loja inexistente, e nada grava na Conta A', async () => {
  usuarioDaSessao = sessoes.socioB
  const antes = await saldoDaPeca()
  const inexistente = '00000000-0000-0000-0000-000000000000'
  for (const caminho of [lote, manual, nota]) {
    const naContaA = await caminho([P + 'CB1'], { lojaId: semente.lojaA, statusNaEntrada: 'em_transporte' })
    const semLoja = await caminho([P + 'CB1'], { lojaId: inexistente, statusNaEntrada: 'em_transporte' })
    assert.ok(naContaA.error, `${caminho.name} gravou na Conta A`)
    assert.deepEqual(naContaA, semLoja, caminho.name)
  }
  assert.deepEqual(await motosGravadas([P + 'CB1']), [])
  assert.equal(await saldoDaPeca(), antes)
})
