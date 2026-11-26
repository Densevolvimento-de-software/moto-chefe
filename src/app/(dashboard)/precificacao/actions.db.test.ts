// Teste de banco: salvar as taxas da Precificação grava só os campos do formulário, sempre no
// grupo ativo do servidor. Inclui o custo do PIX (#89) e a entrada mínima da reserva por loja (#283).
// Roda no Postgres descartável do CI. Local: `npm run test:db:local`.
import { after, before, mock, test } from 'node:test'
import assert from 'node:assert/strict'
import { sql } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import { semearContaBase, semearGrupo, semearLoja, semearUsuario } from '@/test/semear-conta'
import type { TaxasPayload } from './actions'

const url = process.env.TEST_DATABASE_URL
if (!url) throw new Error('TEST_DATABASE_URL não definida — este teste só roda num Postgres descartável')
if (!['localhost', '127.0.0.1'].includes(new URL(url).hostname)) {
  throw new Error('TEST_DATABASE_URL precisa ser loopback (Postgres descartável)')
}
process.env.DATABASE_URL = url

let sessao: Record<string, unknown> = {}
let grupoNoCookie: string | null = null
const mocks = [
  mock.module('@/lib/auth', { namedExports: { getUsuarioLogado: async () => sessao } }),
  mock.module('next/headers', {
    namedExports: { cookies: async () => ({ get: (n: string) => (n === 'grupoAtivo' && grupoNoCookie ? { value: grupoNoCookie } : undefined) }) },
  }),
  mock.module('next/cache', { namedExports: { revalidatePath: () => {} } }),
]

type Db = typeof import('@/lib/db')
let db: Db['db']
let execRows: Db['execRows']
let salvarTaxasAction: typeof import('./actions')['salvarTaxasAction']
let salvarEntradaMinimaReservaAction: typeof import('./actions')['salvarEntradaMinimaReservaAction']
const s = { contaA: '', grupoA: '', contaB: '', grupoB: '', lojaA: '', lojaA2: '', lojaB: '', socioB: '', redeId: '', grupoA2: '', lojaDoGrupoA2: '' }

const TAXAS_B: TaxasPayload = {
  taxasCartao: { '1': 3 }, taxasDebito: { '1': 1 }, taxasLink: {}, taxasFinanciamento: {},
  freteValorKm: '5.00', freteKmGratis: 10, freteValorFixo: '0.00', imposto: '0.0800', custoPixTaxa: '0.005000',
}
const ENVIO: TaxasPayload = {
  taxasCartao: { '1': 9.9 }, taxasDebito: { '1': 9.9 }, taxasLink: { '1': 9.9 }, taxasFinanciamento: { '12': 9.9 },
  freteValorKm: '9.99', freteKmGratis: 99, freteValorFixo: '99.00', imposto: '0.9900', custoPixTaxa: '0.002000',
}

const taxasDo = async (grupoId: string) => (await execRows(sql`
  select taxas_cartao, taxas_debito, taxas_link, taxas_financiamento, frete_valor_km, frete_km_gratis,
    frete_valor_fixo, imposto, custo_pix_taxa, padrao_simulador, atualizado_em > now() - interval '1 hour' as atualizada_agora
  from configuracao_taxas where grupo_id = ${grupoId}`))[0]

before(async () => {
  ;({ db, execRows } = await import('@/lib/db'))
  ;({ salvarTaxasAction, salvarEntradaMinimaReservaAction } = await import('./actions'))
  // A action usa o db global: a semente é gravada e apagada no after.
  const a = await semearContaBase(db, { prefixo: 'PT924', nome: 'A', cnpj: '00000000092401' })
  const b = await semearContaBase(db, { prefixo: 'PT924', nome: 'B', cnpj: '00000000092402' })
  const lojaA2 = await semearLoja(db, a.grupoId, 'PT924 A segunda loja')
  // Outro grupo da MESMA Conta A: o sócio opera o grupo A e não pode gravar na loja deste.
  const grupoDeA2 = await semearGrupo(db, a.contaId, { prefixo: 'PT924', nome: 'A2', cnpj: '00000000092403' })
  const socioA = await semearUsuario(db, a, { papel: 'admin_socio', rotulo: 'socio', semLoja: true, comGrupo: true })
  const socioB = await semearUsuario(db, b, { papel: 'admin_socio', rotulo: 'socio', semLoja: true, comGrupo: true })
  // admin_rede da Conta A: sem liberação nenhuma até o teste liberar o grupo da Conta B.
  const redeId = await semearUsuario(db, a, { papel: 'admin_rede', rotulo: 'rede', comGrupo: true, comConta: true })
  Object.assign(s, { contaA: a.contaId, grupoA: a.grupoId, contaB: b.contaId, grupoB: b.grupoId, lojaA: a.lojaId, lojaA2, lojaB: b.lojaId, socioB, redeId, grupoA2: grupoDeA2.grupoId, lojaDoGrupoA2: grupoDeA2.lojaId })
  sessao = { id: socioA, papel: 'admin_socio', lojaId: null, gruposAcesso: [a.grupoId], contaId: a.contaId, grupoLiberado: null }
  await db.execute(sql`insert into configuracao_taxas (grupo_id, taxas_cartao, taxas_debito, frete_valor_km, frete_km_gratis, imposto, custo_pix_taxa)
    values (${b.grupoId}, ${JSON.stringify(TAXAS_B.taxasCartao)}::jsonb, ${JSON.stringify(TAXAS_B.taxasDebito)}::jsonb,
      ${TAXAS_B.freteValorKm}, ${TAXAS_B.freteKmGratis}, ${TAXAS_B.imposto}, ${TAXAS_B.custoPixTaxa})`)
})

after(async () => {
  // Só o que a semente chegou a criar: um before que falhou no meio não esconde o erro dele.
  const grupos = sql.param([s.grupoA, s.grupoB, s.grupoA2].filter(Boolean))
  const contas = sql.param([s.contaA, s.contaB].filter(Boolean))
  try {
    await db.execute(sql`delete from configuracao_taxas where grupo_id = any(${grupos}::uuid[])`)
    await db.execute(sql`delete from grupos_liberados where grupo_id = any(${grupos}::uuid[])`)
    await db.execute(sql`delete from usuarios where email like '%-pt924-%'`)
    await db.execute(sql`delete from lojas where grupo_id = any(${grupos}::uuid[])`)
    await db.execute(sql`delete from grupos where id = any(${grupos}::uuid[])`)
    await db.execute(sql`delete from contas where id = any(${contas}::uuid[])`)
  } finally {
    for (const m of mocks) m.restore()
    await (globalThis as { __pgPool?: { end(): Promise<void> } }).__pgPool?.end()
  }
})

const comoNoBanco = (t: TaxasPayload) => ({
  taxas_cartao: t.taxasCartao, taxas_debito: t.taxasDebito, taxas_link: t.taxasLink, taxas_financiamento: t.taxasFinanciamento,
  frete_valor_km: t.freteValorKm, frete_km_gratis: t.freteKmGratis, frete_valor_fixo: t.freteValorFixo, imposto: t.imposto, custo_pix_taxa: t.custoPixTaxa,
  padrao_simulador: 'taxas',
  atualizada_agora: true,
})

test('as taxas são gravadas só no grupo ativo, só com os campos do formulário', async () => {
  const comCamposAMais = { ...ENVIO, grupoId: s.grupoB, padraoSimulador: 'avista_12x', atualizadoEm: new Date('2020-01-01') }
  await salvarTaxasAction(comCamposAMais as TaxasPayload)
  assert.deepEqual(await taxasDo(s.grupoB), comoNoBanco(TAXAS_B))
  assert.deepEqual(await taxasDo(s.grupoA), comoNoBanco(ENVIO))
})

test('salvar de novo atualiza a mesma linha do grupo ativo', async () => {
  const outra: TaxasPayload = { ...ENVIO, imposto: '0.0500', freteKmGratis: 30 }
  await salvarTaxasAction(ENVIO)
  await salvarTaxasAction(outra)
  assert.deepEqual(await taxasDo(s.grupoA), comoNoBanco(outra))
  const [{ n }] = await execRows(sql`select count(*)::int n from configuracao_taxas where grupo_id = ${s.grupoA}`)
  assert.equal(n, 1)
})

test('custo do PIX fora da faixa: recusa com a frase e não grava nada', async () => {
  await salvarTaxasAction(ENVIO)
  const recusa = await salvarTaxasAction({ ...ENVIO, imposto: '0.0100', custoPixTaxa: '1' })
  assert.deepEqual(recusa, { ok: false, erro: 'O custo do PIX precisa ser de 0 até menos de 100%' })
  assert.deepEqual(await taxasDo(s.grupoA), comoNoBanco(ENVIO))
  assert.deepEqual(await taxasDo(s.grupoB), comoNoBanco(TAXAS_B))
})

// ─── Entrada mínima da reserva por loja (#283) ───────────────────────────────

const pctDe = async (lojaId: string) => (await execRows(sql`select entrada_minima_reserva_pct as pct from lojas where id = ${lojaId}`))[0]?.pct
const lojaComoNoBanco = async (lojaId: string) => (await execRows(sql`select nome, ativa, grupo_id from lojas where id = ${lojaId}`))[0]
const LOJA_NAO_ENCONTRADA = { ok: false, erro: 'Loja não encontrada' }
const SEM_PERMISSAO = { ok: false, erro: 'Sem permissão' }

async function partirDe(pcts: { lojaA: number; lojaA2: number; lojaB: number }) {
  for (const [chave, pct] of Object.entries(pcts)) {
    await db.execute(sql`update lojas set entrada_minima_reserva_pct = ${pct} where id = ${s[chave as 'lojaA' | 'lojaA2' | 'lojaB']}`)
  }
}
const pctsAgora = async () => ({ lojaA: await pctDe(s.lojaA), lojaA2: await pctDe(s.lojaA2), lojaB: await pctDe(s.lojaB) })
const pctDoGrupoA2 = () => pctDe(s.lojaDoGrupoA2)
const sessaoDoSocioA = () => ({ id: randomUUID(), papel: 'admin_socio', lojaId: null, gruposAcesso: [s.grupoA], contaId: s.contaA, grupoLiberado: null })

test('o sócio grava a porcentagem de cada loja do grupo ativo, e só ela', async () => {
  await partirDe({ lojaA: 30, lojaA2: 30, lojaB: 30 })
  sessao = sessaoDoSocioA()
  const antes = await lojaComoNoBanco(s.lojaA)
  const r = await salvarEntradaMinimaReservaAction([{ lojaId: s.lojaA, pct: 20 }, { lojaId: s.lojaA2, pct: 0 }])
  assert.equal(r.ok, true)
  assert.deepEqual(await pctsAgora(), { lojaA: 20, lojaA2: 0, lojaB: 30 })
  assert.deepEqual(await lojaComoNoBanco(s.lojaA), antes)
})

test('admin_geral grava no grupo que está operando', async () => {
  await partirDe({ lojaA: 30, lojaA2: 30, lojaB: 30 })
  sessao = { id: randomUUID(), papel: 'admin_geral', lojaId: null, gruposAcesso: [], contaId: null, grupoLiberado: null }
  grupoNoCookie = s.grupoA
  try {
    assert.equal((await salvarEntradaMinimaReservaAction([{ lojaId: s.lojaA, pct: 25 }])).ok, true)
  } finally { grupoNoCookie = null }
  assert.deepEqual(await pctsAgora(), { lojaA: 25, lojaA2: 30, lojaB: 30 })
})

test('pedido forjado: campos a mais (grupo, nome, ativa) não gravam nada além da porcentagem', async () => {
  await partirDe({ lojaA: 30, lojaA2: 30, lojaB: 30 })
  sessao = sessaoDoSocioA()
  const antes = await lojaComoNoBanco(s.lojaA)
  const antesB = await lojaComoNoBanco(s.lojaB)
  const forjado = [{ lojaId: s.lojaA, pct: 20, grupoId: s.grupoB, nome: 'Loja forjada', ativa: false, entradaMinimaReservaPct: 99 }]
  assert.equal((await salvarEntradaMinimaReservaAction(forjado)).ok, true)
  assert.deepEqual(await lojaComoNoBanco(s.lojaA), antes)
  assert.deepEqual(await lojaComoNoBanco(s.lojaB), antesB)
  assert.deepEqual(await pctsAgora(), { lojaA: 20, lojaA2: 30, lojaB: 30 })
})

test('loja de outra Conta e loja inexistente recebem a mesma frase, e nada do pedido é gravado', async () => {
  await partirDe({ lojaA: 30, lojaA2: 30, lojaB: 30 })
  sessao = sessaoDoSocioA()
  const deOutraConta = await salvarEntradaMinimaReservaAction([{ lojaId: s.lojaA, pct: 20 }, { lojaId: s.lojaB, pct: 0 }])
  const inexistente = await salvarEntradaMinimaReservaAction([{ lojaId: s.lojaA, pct: 20 }, { lojaId: randomUUID(), pct: 0 }])
  assert.deepEqual(deOutraConta, LOJA_NAO_ENCONTRADA)
  assert.deepEqual(inexistente, LOJA_NAO_ENCONTRADA)
  assert.deepEqual(await pctsAgora(), { lojaA: 30, lojaA2: 30, lojaB: 30 })
})

test('loja de OUTRO grupo da mesma Conta: "Loja não encontrada" e nada do pedido é gravado', async () => {
  await partirDe({ lojaA: 30, lojaA2: 30, lojaB: 30 })
  sessao = sessaoDoSocioA()
  const r = await salvarEntradaMinimaReservaAction([{ lojaId: s.lojaA, pct: 20 }, { lojaId: s.lojaDoGrupoA2, pct: 0 }])
  assert.deepEqual(r, LOJA_NAO_ENCONTRADA)
  assert.deepEqual(await pctsAgora(), { lojaA: 30, lojaA2: 30, lojaB: 30 })
  assert.equal(await pctDoGrupoA2(), 30)
})

test('aux_adm e vendedor são recusados e nada é gravado', async () => {
  await partirDe({ lojaA: 30, lojaA2: 30, lojaB: 30 })
  for (const papel of ['aux_adm', 'vendedor']) {
    sessao = { id: randomUUID(), papel, lojaId: s.lojaA, gruposAcesso: [], contaId: s.contaA, grupoLiberado: null }
    assert.deepEqual(await salvarEntradaMinimaReservaAction([{ lojaId: s.lojaA, pct: 0 }]), SEM_PERMISSAO, papel)
  }
  assert.deepEqual(await pctsAgora(), { lojaA: 30, lojaA2: 30, lojaB: 30 })
})

test('porcentagem fracionária, fora de 0 a 100, em texto ou pedido vazio: recusa e não grava nada', async () => {
  await partirDe({ lojaA: 30, lojaA2: 30, lojaB: 30 })
  sessao = sessaoDoSocioA()
  const ruins: unknown[] = [
    [{ lojaId: s.lojaA, pct: 20.5 }], [{ lojaId: s.lojaA, pct: -1 }], [{ lojaId: s.lojaA, pct: 101 }], [{ lojaId: s.lojaA, pct: '20' }],
    [{ lojaId: s.lojaA, pct: 20 }, { lojaId: s.lojaA2, pct: 200 }], [{ lojaId: s.lojaA, pct: 20 }, { lojaId: s.lojaA, pct: 10 }], [], null,
  ]
  for (const ruim of ruins) {
    const r = await salvarEntradaMinimaReservaAction(ruim)
    assert.equal(r.ok, false, JSON.stringify(ruim))
    assert.match(r.ok ? '' : r.erro, /inteiro de 0 a 100/, JSON.stringify(ruim))
  }
  assert.deepEqual(await pctsAgora(), { lojaA: 30, lojaA2: 30, lojaB: 30 })
})

test('o banco recusa porcentagem fora de 0 a 100 mesmo por SQL direto', async () => {
  await assert.rejects(db.execute(sql`update lojas set entrada_minima_reserva_pct = 101 where id = ${s.lojaA}`))
  await assert.rejects(db.execute(sql`update lojas set entrada_minima_reserva_pct = -1 where id = ${s.lojaA}`))
})

// admin_rede chega ao servidor como admin_socio; no grupo liberado de outra Conta vira a persona dele (ADR-0019).
// A sessão vem das mesmas funções do getUsuarioLogado, não de um objeto escrito à mão.
async function sessaoDaRede() {
  const { gruposLiberadosVivos, usuarioDaRede } = await import('@/lib/grupos-liberados')
  const linha = { id: s.redeId, papel: 'admin_rede', lojaId: null, contaId: s.contaA, gruposAcesso: [s.grupoA], gruposAprovacao: [] as string[] }
  sessao = usuarioDaRede(linha, await gruposLiberadosVivos(s.redeId), grupoNoCookie)
}

test('admin_rede no grupo liberado de outra Conta: grava lá, como as taxas; a loja da própria Conta é "não encontrada"', async () => {
  await partirDe({ lojaA: 30, lojaA2: 30, lojaB: 30 })
  const [geral] = await execRows(sql`insert into usuarios (id, nome, email, papel) values (${randomUUID()}, 'geral 924', ${`geral-pt924-${randomUUID()}@teste.invalid`}, 'admin_geral') returning id`)
  await db.execute(sql`insert into grupos_liberados (usuario_id, grupo_id, liberado_por) values (${s.redeId}, ${s.grupoB}, ${geral.id})`)
  grupoNoCookie = s.grupoB
  try {
    await sessaoDaRede()
    assert.equal((await salvarEntradaMinimaReservaAction([{ lojaId: s.lojaB, pct: 10 }])).ok, true)
    assert.equal((await salvarTaxasAction({ ...TAXAS_B, imposto: '0.0700' })).ok, true) // a vizinha também grava no grupo liberado
    assert.equal((await taxasDo(s.grupoB)).imposto, '0.0700')
    assert.deepEqual(await salvarEntradaMinimaReservaAction([{ lojaId: s.lojaA, pct: 0 }]), LOJA_NAO_ENCONTRADA)
    assert.deepEqual(await pctsAgora(), { lojaA: 30, lojaA2: 30, lojaB: 10 })
  } finally {
    grupoNoCookie = null
    await db.execute(sql`delete from grupos_liberados where usuario_id = ${s.redeId}`)
    await db.execute(sql`delete from usuarios where id = ${geral.id}`)
  }
})

test('admin_rede em grupo NÃO liberado: a loja de lá recebe a mesma frase e nada é gravado', async () => {
  await partirDe({ lojaA: 30, lojaA2: 30, lojaB: 30 })
  grupoNoCookie = s.grupoB // o navegador aponta para o grupo da Conta B, que ninguém liberou
  try {
    await sessaoDaRede()
    assert.deepEqual(await salvarEntradaMinimaReservaAction([{ lojaId: s.lojaB, pct: 0 }]), LOJA_NAO_ENCONTRADA)
    assert.deepEqual(await pctsAgora(), { lojaA: 30, lojaA2: 30, lojaB: 30 })
  } finally { grupoNoCookie = null }
})
