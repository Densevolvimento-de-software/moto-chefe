// Migrações 0209 e 0210 (Serviços por Conta, #273) uma depois da outra no mesmo banco, sobre cópias das
// tabelas REAIS. O banco do teste já tem as duas aplicadas, e os arquivos do test:db rodam em paralelo nele:
// mexer na `servicos_catalogo` ou na `os_itens` de verdade seguraria lock exclusivo que outro arquivo espera
// (deadlock ou falha em arquivo alheio, como o teste instável da #287). Por isso o `before` cria um schema só
// deste processo com cópias das tabelas (`create table ... like ... including all`: colunas, defaults, NOT NULL
// e checks vêm do schema real), leva `servicos_catalogo` ao estado de antes da 0209 e cada teste roda o SQL dos
// arquivos nele, dentro de transação desfeita, com `search_path = <schema>, pg_catalog`: só as tabelas espelhadas
// existem para o SQL, e uma tabela que ninguém espelhou dá erro em vez de cair na tabela real. O estado do schema
// real (FK, índice, NOT NULL) é conferido à parte, só por leitura. Só se conta o que o próprio teste criou (MIG273).
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { sql } from 'drizzle-orm'
import { idDoInsert, semearContaBase, semearUsuario, type Base } from '@/test/semear-conta'

const url = process.env.TEST_DATABASE_URL
if (!url || !['localhost', '127.0.0.1'].includes(new URL(url).hostname)) throw new Error('Use somente Postgres descartável local')
process.env.DATABASE_URL = url

const P = 'MIG273'
const arquivo = (nome: string) => readFileSync(`src/lib/db/migrations/${nome}`, 'utf8')
const M0209 = arquivo('0209_servicos_copias_por_conta.sql')

type Db = typeof import('@/lib/db')['db']
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0]
let db: Db

const espelho = `mig273_${process.pid}`
const TABELAS_ESPELHADAS = ['contas', 'grupos', 'lojas', 'usuarios', 'ordens_servico', 'os_itens', 'servicos_catalogo']
// As chaves entre as cópias (a LIKE não copia chave estrangeira). A conferência dos nomes reais está no teste do schema real.
const CHAVES_DO_ESPELHO = [
  ['grupos', 'conta_id', 'contas'], ['lojas', 'grupo_id', 'grupos'], ['ordens_servico', 'loja_id', 'lojas'],
  ['os_itens', 'os_id', 'ordens_servico'], ['os_itens', 'servico_id', 'servicos_catalogo'], ['servicos_catalogo', 'conta_id', 'contas'],
] as const

class Desfazer extends Error {}
async function emTransacaoDesfeita(corpo: (tx: Tx) => Promise<void>) {
  await assert.rejects(db.transaction(async tx => { await corpo(tx); throw new Desfazer() }), Desfazer)
}

// O erro do Drizzle repete o SQL inteiro na mensagem (inclusive o texto do raise); a recusa vem na causa.
const abortaCom = (execucao: Promise<unknown>, frase: string) =>
  assert.rejects(execucao, (e: unknown) => (e as { cause?: { message?: string } }).cause?.message === frase)

const linhas = async <T>(tx: Pick<Tx, 'execute'>, q: ReturnType<typeof sql>) => ((await tx.execute(q)) as unknown as { rows: T[] }).rows

// Estado de antes da 0209 no schema espelho: sem o índice e sem a coluna da marca (a cópia as traz quando a 0209
// já está no schema real), e com conta_id aceitando nulo.
async function criarEspelho() {
  await db.execute(sql.raw(`drop schema if exists ${espelho} cascade`))
  await db.execute(sql.raw(`create schema ${espelho}`))
  for (const t of TABELAS_ESPELHADAS) await db.execute(sql.raw(`create table ${espelho}.${t} (like public.${t} including all)`))
  for (const [tabela, coluna, alvo] of CHAVES_DO_ESPELHO) {
    await db.execute(sql.raw(`alter table ${espelho}.${tabela} add foreign key (${coluna}) references ${espelho}.${alvo}(id)`))
  }
  await db.execute(sql.raw(`drop index if exists ${espelho}.servicos_catalogo_conta_id_idx`))
  await db.execute(sql.raw(`alter table ${espelho}.servicos_catalogo drop column if exists migracao_273_origem`))
  await db.execute(sql.raw(`alter table ${espelho}.servicos_catalogo alter column conta_id drop not null`))
}
const noEspelho = (tx: Tx) => tx.execute(sql.raw(`set local search_path = ${espelho}, pg_catalog`))

type Semente = {
  a: Base; b: Base; c: Base; d: Base; osA: string; osA2: string; osB: string; osC: string
  revisao: string; soA: string; semUsoAtivo: string; semUsoInativo: string; jaDaC: string
  itemRevisaoA: string; itemRevisaoA2: string; itemRevisaoA3: string; itemRevisaoB: string; itemSoA: string; itemAvulso: string; itemJaDaC: string
}

async function semear(tx: Tx): Promise<Semente> {
  const a = await semearContaBase(tx, { prefixo: P, nome: 'A', cnpj: '00000000209001' })
  const b = await semearContaBase(tx, { prefixo: P, nome: 'B', cnpj: '00000000209002' })
  const c = await semearContaBase(tx, { prefixo: P, nome: 'C', cnpj: '00000000209003' })
  const d = await semearContaBase(tx, { prefixo: P, nome: 'D', cnpj: '00000000209004' })
  const usuario = await semearUsuario(tx, a, { papel: 'aux_adm' })
  const os = (base: Base) => idDoInsert(tx, sql`insert into ordens_servico (loja_id, aberta_por, descricao) values (${base.lojaId}, ${usuario}, ${`${P} OS`}) returning id`)
  const global = (nome: string, valor: number, ativo: boolean, minutos: number | null) =>
    idDoInsert(tx, sql`insert into servicos_catalogo (conta_id, nome, valor, ativo, tempo_previsto_minutos) values (null, ${`${P} ${nome}`}, ${valor}, ${ativo}, ${minutos}) returning id`)
  const item = (osId: string, servicoId: string | null, descricao: string, valor: number) =>
    idDoInsert(tx, sql`insert into os_itens (os_id, servico_id, tipo, descricao, quantidade, valor_unitario) values (${osId}, ${servicoId}, 'servico', ${descricao}, 1, ${valor}) returning id`)

  const revisao = await global('Revisão', 100, false, 45)
  const soA = await global('Só A', 30, true, 15)
  const semUsoAtivo = await global('Sem uso ativo', 50, true, null)
  const semUsoInativo = await global('Sem uso inativo', 60, false, null)
  const jaDaC = await idDoInsert(tx, sql`insert into servicos_catalogo (conta_id, nome, valor) values (${c.contaId}, ${`${P} Já da C`}, 70) returning id`)
  const [osA, osA2, osB, osC] = [await os(a), await os(a), await os(b), await os(c)]
  return {
    a, b, c, d, osA, osA2, osB, osC, revisao, soA, semUsoAtivo, semUsoInativo, jaDaC,
    itemRevisaoA: await item(osA, revisao, 'Nome histórico A', 80),
    // O caso comum em produção: o mesmo serviço em vários itens e em várias OS da mesma Conta.
    itemRevisaoA2: await item(osA, revisao, 'Outro item da mesma OS', 70),
    itemRevisaoA3: await item(osA2, revisao, 'Item de outra OS da A', 60),
    itemRevisaoB: await item(osB, revisao, 'Nome histórico B', 90),
    itemSoA: await item(osA, soA, 'Só A na OS', 30),
    itemAvulso: await item(osA, null, 'Mão de obra avulsa', 25),
    itemJaDaC: await item(osC, jaDaC, 'Já da C na OS', 70),
  }
}

type ItemDaOS = { id: string; descricao: string; valor_unitario: string; servico_id: string | null; conta_id: string | null; nome: string | null }
const itensDaOS = (tx: Tx, ids: string[]) => linhas<ItemDaOS>(tx, sql`
  select i.id, i.descricao, i.valor_unitario, i.servico_id, s.conta_id, s.nome
  from os_itens i left join servicos_catalogo s on s.id = i.servico_id where i.id = any(${sql.param(ids)}::uuid[])`)
const servicosDasContas = (tx: Tx, contas: string[]) => linhas<{ id: string; conta_id: string | null; nome: string; ativo: boolean; valor: string; tempo_previsto_minutos: number | null; migracao_273_origem?: boolean }>(tx, sql`
  select * from servicos_catalogo where conta_id = any(${sql.param(contas)}::uuid[]) order by nome`)
const originais = (tx: Tx, ids: string[]) => linhas<{ id: string; migracao_273_origem: boolean }>(tx, sql`
  select id, migracao_273_origem from servicos_catalogo where id = any(${sql.param(ids)}::uuid[]) order by id`)

before(async () => {
  ;({ db } = await import('@/lib/db'))
  await criarEspelho()
})
after(async () => {
  try {
    await db.execute(sql.raw(`drop schema if exists ${espelho} cascade`))
  } finally {
    await (globalThis as { __pgPool?: { end(): Promise<void> } }).__pgPool?.end()
  }
})

test('0209: serviço usado por duas Contas vira uma cópia em cada, sem tocar o histórico do item; sem uso não é copiado', async () => {
  await emTransacaoDesfeita(async tx => {
    await noEspelho(tx)
    const s = await semear(tx)
    await tx.execute(sql.raw(M0209))

    const copiasA = await servicosDasContas(tx, [s.a.contaId])
    const copiasB = await servicosDasContas(tx, [s.b.contaId])
    assert.deepEqual(copiasA.map(x => x.nome), [`${P} Revisão`, `${P} Só A`])
    assert.deepEqual(copiasB.map(x => x.nome), [`${P} Revisão`])
    // A cópia leva nome, valor, tempo e estado do original (Revisão é inativa, 45 min, 100,00).
    const revisaoDaA = copiasA[0]
    assert.deepEqual([revisaoDaA.valor, revisaoDaA.ativo, revisaoDaA.tempo_previsto_minutos], ['100.00', false, 45])

    const itens = await itensDaOS(tx, [s.itemRevisaoA, s.itemRevisaoA2, s.itemRevisaoA3, s.itemRevisaoB, s.itemSoA])
    const porId = Object.fromEntries(itens.map(i => [i.id, i]))
    // Vários itens e várias OS da Conta A com o mesmo serviço: uma cópia só (conferida acima), todos religados a ela.
    assert.equal(new Set([s.itemRevisaoA, s.itemRevisaoA2, s.itemRevisaoA3].map(id => porId[id].servico_id)).size, 1)
    assert.deepEqual([porId[s.itemRevisaoA2].descricao, porId[s.itemRevisaoA3].descricao, porId[s.itemRevisaoA3].valor_unitario], ['Outro item da mesma OS', 'Item de outra OS da A', '60.00'])
    assert.equal(porId[s.itemRevisaoA].conta_id, s.a.contaId)
    assert.equal(porId[s.itemRevisaoB].conta_id, s.b.contaId)
    assert.equal(porId[s.itemSoA].conta_id, s.a.contaId)
    assert.notEqual(porId[s.itemRevisaoA].servico_id, porId[s.itemRevisaoB].servico_id)
    assert.deepEqual([porId[s.itemRevisaoA].descricao, porId[s.itemRevisaoA].valor_unitario], ['Nome histórico A', '80.00'])
    assert.deepEqual([porId[s.itemRevisaoB].descricao, porId[s.itemRevisaoB].valor_unitario], ['Nome histórico B', '90.00'])

    assert.deepEqual(await servicosDasContas(tx, [s.d.contaId]), [], 'Conta sem uso não recebe cópia')
    const todasAsCopias = [...copiasA, ...copiasB]
    assert.ok(!todasAsCopias.some(x => x.nome.includes('Sem uso')), 'serviço sem uso não é copiado')
  })
})

test('0209: item de OS sem serviço e serviço que já tem Conta ficam como estavam; os originais ganham a marca de origem', async () => {
  await emTransacaoDesfeita(async tx => {
    await noEspelho(tx)
    const s = await semear(tx)
    await tx.execute(sql.raw(M0209))

    const [avulso, jaDaC] = [(await itensDaOS(tx, [s.itemAvulso]))[0], (await itensDaOS(tx, [s.itemJaDaC]))[0]]
    assert.equal(avulso.servico_id, null)
    assert.equal(jaDaC.servico_id, s.jaDaC)
    assert.deepEqual((await servicosDasContas(tx, [s.c.contaId])).map(x => x.id), [s.jaDaC], 'a Conta C não ganhou cópia')

    const marcas = Object.fromEntries((await originais(tx, [s.revisao, s.soA, s.semUsoAtivo, s.semUsoInativo, s.jaDaC])).map(x => [x.id, x.migracao_273_origem]))
    assert.deepEqual([marcas[s.revisao], marcas[s.soA], marcas[s.semUsoAtivo], marcas[s.semUsoInativo]], [true, true, true, true])
    assert.equal(marcas[s.jaDaC], false, 'serviço que já tinha Conta não é original')
    const copias = await servicosDasContas(tx, [s.a.contaId, s.b.contaId])
    assert.ok(copias.every(x => x.migracao_273_origem === false), 'as cópias não levam a marca')
    const indice = await linhas<{ n: number }>(tx, sql`select count(*)::int n from pg_indexes where schemaname = ${espelho} and tablename = 'servicos_catalogo' and indexname = 'servicos_catalogo_conta_id_idx'`)
    assert.equal(indice[0].n, 1)
  })
})

test('0209 aborta se uma OS aponta para serviço de outra Conta', async () => {
  await emTransacaoDesfeita(async tx => {
    await noEspelho(tx)
    const s = await semear(tx)
    await tx.execute(sql`insert into os_itens (os_id, servico_id, tipo, descricao) values (${s.osB}, ${s.jaDaC}, 'servico', ${`${P} cruzado`})`)
    await abortaCom(tx.execute(sql.raw(M0209)), 'OS ligada a serviço de outra Conta: migração cancelada')
  })
})

// Com um leitor com a transação aberta na tabela, o lock exclusivo da migração tem de desistir sozinho.
// O limite é encurtado no texto do SQL só para o teste não esperar 5 s; a conferência de que a linha
// `set local lock_timeout` existe no arquivo é o que prende a trava. Roda no schema espelho (já gravado),
// então o leitor e a migração são duas conexões que só disputam entre si.
async function desisteDoLock(sqlDaMigracao: string, tabelaDoLeitor: string) {
  assert.ok(sqlDaMigracao.includes("set local lock_timeout = '5s';"), 'a migração limita a espera do lock')
  const comLimiteCurto = sqlDaMigracao.replace("set local lock_timeout = '5s';", "set local lock_timeout = '200ms';")
  await emTransacaoDesfeita(async leitor => {
    await noEspelho(leitor)
    await leitor.execute(sql`select 1 from ${sql.raw(tabelaDoLeitor)} limit 1`)
    await assert.rejects(
      db.transaction(async tx => { await noEspelho(tx); await tx.execute(sql.raw(comLimiteCurto)) }),
      (e: unknown) => /lock timeout/.test((e as { cause?: { message?: string } }).cause?.message ?? ''),
    )
  })
}

test('0209 desiste do lock exclusivo em vez de esperar um leitor com a transação aberta', () => desisteDoLock(M0209, 'servicos_catalogo'))

test('schema real depois da 0209: chave e índice da Conta com o nome esperado', async () => {
  const chaves = await linhas<{ conname: string }>(db, sql`select conname from pg_constraint where conrelid = 'public.servicos_catalogo'::regclass and contype = 'f'`)
  assert.deepEqual(chaves.map(x => x.conname), ['servicos_catalogo_conta_id_fkey'])
  const [indice] = await linhas<{ n: number }>(db, sql`select count(*)::int n from pg_indexes where schemaname = 'public' and tablename = 'servicos_catalogo' and indexname = 'servicos_catalogo_conta_id_idx'`)
  assert.equal(indice.n, 1)
})

// ─── 0210 (entra com a fatia da 0210) ─────────────────────────────────────────
const M0210 = arquivo('0210_servicos_concluir_contas.sql')

test('0210 depois da 0209: apaga os originais (inclusive o ativo sem uso), exige Conta e tira a marca; o resto fica', async () => {
  await emTransacaoDesfeita(async tx => {
    await noEspelho(tx)
    const s = await semear(tx)
    await tx.execute(sql.raw(M0209))
    await tx.execute(sql.raw(M0210))

    const marca = await linhas<{ n: number }>(tx, sql`select count(*)::int n from information_schema.columns where table_schema = ${espelho} and table_name = 'servicos_catalogo' and column_name = 'migracao_273_origem'`)
    assert.equal(marca[0].n, 0, 'a coluna da marca saiu da tabela')
    const sobraram = await linhas<{ id: string }>(tx, sql`select id from servicos_catalogo where id = any(${sql.param([s.revisao, s.soA, s.semUsoAtivo, s.semUsoInativo])}::uuid[])`)
    assert.deepEqual(sobraram, [], 'os quatro originais saíram, inclusive o ativo que nunca foi usado')
    assert.equal((await linhas<{ n: number }>(tx, sql`select count(*)::int n from servicos_catalogo where conta_id is null`))[0].n, 0)

    const itens = await itensDaOS(tx, [s.itemRevisaoA, s.itemRevisaoA2, s.itemRevisaoA3, s.itemRevisaoB, s.itemSoA, s.itemAvulso, s.itemJaDaC])
    assert.equal(itens.length, 7, 'nenhum item de OS se perdeu')
    assert.equal(itens.filter(i => i.servico_id && !i.nome).length, 0, 'todo item com serviço aponta para um serviço que existe')
    assert.deepEqual((await servicosDasContas(tx, [s.d.contaId])), [])
    assert.deepEqual((await servicosDasContas(tx, [s.c.contaId])).map(x => x.id), [s.jaDaC])

    const coluna = await linhas<{ is_nullable: string }>(tx, sql`select is_nullable from information_schema.columns where table_schema = ${espelho} and table_name = 'servicos_catalogo' and column_name = 'conta_id'`)
    assert.equal(coluna[0].is_nullable, 'NO')
    // Último comando do teste: o erro aborta a transação, que de qualquer jeito é desfeita.
    await assert.rejects(tx.execute(sql`insert into servicos_catalogo (conta_id, nome) values (null, ${`${P} sem Conta`})`), /conta_id/)
  })
})

test('0210 aborta se sobrou serviço global criado depois da cópia, item ligado a global ou item ligado a serviço de outra Conta', async () => {
  await emTransacaoDesfeita(async tx => {
    await noEspelho(tx)
    const s = await semear(tx)
    await tx.execute(sql.raw(M0209))
    await tx.execute(sql`savepoint depois_da_0209`)
    await tx.execute(sql`insert into servicos_catalogo (conta_id, nome) values (null, ${`${P} criado depois`})`)
    await abortaCom(tx.execute(sql.raw(M0210)), 'Serviço global criado após a cópia: migração cancelada')
    await tx.execute(sql`rollback to savepoint depois_da_0209`)

    // Código antigo no ar entre as duas migrações pode ligar um item da Conta A à cópia da Conta B.
    const copiaDaB = (await servicosDasContas(tx, [s.b.contaId]))[0].id
    await tx.execute(sql`insert into os_itens (os_id, servico_id, tipo, descricao) values (${s.osA}, ${copiaDaB}, 'servico', ${`${P} cruzado depois`})`)
    await abortaCom(tx.execute(sql.raw(M0210)), 'OS ligada a serviço de outra Conta: migração cancelada')
    await tx.execute(sql`rollback to savepoint depois_da_0209`)

    await tx.execute(sql`insert into os_itens (os_id, servico_id, tipo, descricao) values (${s.osA}, ${s.semUsoAtivo}, 'servico', ${`${P} ligado ao global`})`)
    await abortaCom(tx.execute(sql.raw(M0210)), 'OS ainda aponta para serviço global: migração cancelada')
  })
})

test('0210 desiste do lock exclusivo em vez de esperar um leitor com a transação aberta', () => desisteDoLock(M0210, 'os_itens'))

test('schema real depois da 0210: Conta obrigatória e sem a coluna da marca', async () => {
  const [coluna] = await linhas<{ is_nullable: string }>(db, sql`select is_nullable from information_schema.columns where table_schema = 'public' and table_name = 'servicos_catalogo' and column_name = 'conta_id'`)
  assert.equal(coluna.is_nullable, 'NO')
  const [marca] = await linhas<{ n: number }>(db, sql`select count(*)::int n from information_schema.columns where table_schema = 'public' and table_name = 'servicos_catalogo' and column_name = 'migracao_273_origem'`)
  assert.equal(marca.n, 0)
})
