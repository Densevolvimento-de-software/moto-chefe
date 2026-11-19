// Teste de banco: Postgres descartável, como src/lib/rotulos-alvo.db.test.ts.
// As listas de /despesas e /caixa só mostram loja, beneficiário e nome de quem lançou ou aprovou que a
// Conta do grupo enxerga; o resto sai como id inexistente, e a linha do próprio grupo nunca some (#132).
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { semearContaBase, semearGrupo, semearUsuario, type Base } from '@/test/semear-conta'
import { semearDespesa, semearLancamentoCaixa, semearSaidaDoExtrato } from '@/test/semear-despesas'

const url = process.env.TEST_DATABASE_URL
if (!url) throw new Error('TEST_DATABASE_URL não definida — este teste só roda num Postgres descartável')
if (!['localhost', '127.0.0.1'].includes(new URL(url).hostname)) {
  throw new Error('TEST_DATABASE_URL precisa ser loopback (Postgres descartável)')
}
process.env.DATABASE_URL = url

type Db = typeof import('@/lib/db')
type Tx = Parameters<Parameters<Db['db']['transaction']>[0]>[0]
let db: Db['db']
let saidas: typeof import('@/lib/saidas-banco')
let caixa: typeof import('@/lib/lancamentos-caixa')
let manuais: typeof import('@/lib/despesas-manuais')

before(async () => {
  ;({ db } = await import('@/lib/db'))
  saidas = await import('@/lib/saidas-banco')
  caixa = await import('@/lib/lancamentos-caixa')
  manuais = await import('@/lib/despesas-manuais')
})

after(async () => {
  await (globalThis as { __pgPool?: { end(): Promise<void> } }).__pgPool?.end()
})

class Desfazer extends Error {}

async function emTransacaoDesfeita(fn: (tx: Tx) => Promise<void>) {
  await assert.rejects(db.transaction(async tx => { await fn(tx); throw new Desfazer() }), Desfazer)
}

const PERIODO = { inicio: '2026-09-01', fim: '2026-09-30' }
const grupoDe = (b: Pick<Base, 'grupoId' | 'contaId'>) => ({ id: b.grupoId, contaId: b.contaId })

async function semearConta(tx: Tx, nome: string) {
  const base = await semearContaBase(tx, { prefixo: 'DESP132', nome: `${nome}-${randomUUID()}`, cnpj: randomUUID() })
  const aux = await semearUsuario(tx, base, { papel: 'aux_adm', rotulo: `aux-${randomUUID()}`, nomeDoUsuario: `Aux ${nome}`, comConta: true })
  return { base, aux }
}

// Despesa manual, saída de caixa aprovada e saída do extrato lançada, todas no grupo de `base`.
async function lancamentosNoGrupo(tx: Tx, base: Base, quem: string, lojaId = base.lojaId) {
  const despesa = await semearDespesa(tx, { grupoId: base.grupoId, usuarioId: quem, lojaId, beneficiario: 'Sócio X' })
  const lancamento = await semearLancamentoCaixa(tx, { lojaId: base.lojaId, usuarioId: quem, aprovadoPorId: quem })
  const saida = await semearSaidaDoExtrato(tx, { grupoId: base.grupoId, categoria: 'Outros', lojaId, despesaId: despesa, lancadoPorId: quem })
  return { despesa, lancamento, saida }
}

const nomesDasListas = async (tx: Tx, base: Base) => ({
  manuais: (await manuais.despesasManuaisDoPeriodo(grupoDe(base), PERIODO, tx)).map(r => [r.lojaNome, r.usuarioNome]),
  caixa: (await caixa.lancamentosCaixaDoPeriodo(grupoDe(base), { lojaIds: [base.lojaId], ...PERIODO }, tx)).map(r => [r.usuarioNome, r.aprovadoPorNome]),
})

test('guarda: a própria Conta vê loja, beneficiário e nomes de quem lançou e aprovou', async () => {
  await emTransacaoDesfeita(async tx => {
    const a = await semearConta(tx, 'A')
    const l = await lancamentosNoGrupo(tx, a.base, a.aux)
    assert.deepEqual(await nomesDasListas(tx, a.base), { manuais: [], caixa: [['Aux A', 'Aux A']] })
    const r = await saidas.rotulosDasSaidas(grupoDe(a.base), { lojaIds: [a.base.lojaId], despesaIds: [l.despesa], lancadoPorIds: [a.aux] }, tx)
    assert.deepEqual([r.lojaNome.has(a.base.lojaId), r.beneficiario.get(l.despesa), r.lancadoPorNome.get(a.aux)], [true, 'Sócio X', 'Aux A'])
    // A despesa ligada a uma saída do extrato fica fora da lista manual; a manual solta aparece.
    await semearDespesa(tx, { grupoId: a.base.grupoId, usuarioId: a.aux, lojaId: a.base.lojaId })
    assert.equal((await nomesDasListas(tx, a.base)).manuais.length, 1)
  })
})

test('usuário de outra Conta que lançou ou aprovou no grupo: a linha fica, o nome não aparece', async () => {
  await emTransacaoDesfeita(async tx => {
    const a = await semearConta(tx, 'A')
    const b = await semearConta(tx, 'B')
    await semearDespesa(tx, { grupoId: a.base.grupoId, usuarioId: b.aux, lojaId: a.base.lojaId })
    await semearLancamentoCaixa(tx, { lojaId: a.base.lojaId, usuarioId: b.aux, aprovadoPorId: b.aux })
    const listas = await nomesDasListas(tx, a.base)
    assert.deepEqual(listas.manuais.map(([, nome]) => nome), [null])
    assert.deepEqual(listas.caixa, [[null, null]])
    const r = await saidas.rotulosDasSaidas(grupoDe(a.base), { lojaIds: [], despesaIds: [], lancadoPorIds: [b.aux] }, tx)
    assert.deepEqual([...r.lancadoPorNome], [])
  })
})

test('Conta B não lê loja, beneficiário nem quem lançou das saídas da A; igual a id inexistente', async () => {
  await emTransacaoDesfeita(async tx => {
    const a = await semearConta(tx, 'A')
    const b = await semearConta(tx, 'B')
    const l = await lancamentosNoGrupo(tx, a.base, a.aux)
    for (const ids of [{ lojaIds: [a.base.lojaId], despesaIds: [l.despesa], lancadoPorIds: [a.aux] },
      { lojaIds: [randomUUID()], despesaIds: [randomUUID()], lancadoPorIds: [randomUUID()] }]) {
      const r = await saidas.rotulosDasSaidas(grupoDe(b.base), ids, tx)
      assert.deepEqual([[...r.lojaNome], [...r.beneficiario], [...r.lancadoPorNome]], [[], [], []])
    }
  })
})

test('loja e despesa de outro grupo da mesma Conta não aparecem; quem é de outro grupo da Conta aparece', async () => {
  await emTransacaoDesfeita(async tx => {
    const a = await semearConta(tx, 'A')
    const a2 = await semearGrupo(tx, a.base.contaId, { prefixo: 'DESP132', nome: `A2-${randomUUID()}`, cnpj: randomUUID() })
    const deA2 = await semearUsuario(tx, { ...a.base, ...a2, nome: `A2-${randomUUID()}` }, { papel: 'aux_adm', nomeDoUsuario: 'Aux A2', comConta: true })
    await semearDespesa(tx, { grupoId: a.base.grupoId, usuarioId: deA2, lojaId: a2.lojaId })
    assert.deepEqual((await nomesDasListas(tx, a.base)).manuais, [[null, 'Aux A2']])
    const despesaDeA2 = await semearDespesa(tx, { grupoId: a2.grupoId, usuarioId: deA2, beneficiario: 'Sócio Y' })
    const r = await saidas.rotulosDasSaidas(grupoDe(a.base), { lojaIds: [a2.lojaId], despesaIds: [despesaDeA2], lancadoPorIds: [deA2] }, tx)
    assert.deepEqual([[...r.lojaNome], [...r.beneficiario], r.lancadoPorNome.get(deA2)], [[], [], 'Aux A2'])
  })
})

test('guarda: admin_geral que lançou aparece por nome', async () => {
  await emTransacaoDesfeita(async tx => {
    const a = await semearConta(tx, 'A')
    const geral = await semearUsuario(tx, a.base, { papel: 'admin_geral', rotulo: `geral-${randomUUID()}`, nomeDoUsuario: 'Geral', semLoja: true })
    await semearLancamentoCaixa(tx, { lojaId: a.base.lojaId, usuarioId: geral })
    assert.deepEqual((await nomesDasListas(tx, a.base)).caixa, [['Geral', null]])
  })
})
