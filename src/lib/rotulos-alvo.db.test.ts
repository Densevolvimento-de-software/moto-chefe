// Teste de banco: Postgres descartável, como src/lib/holerites-do-grupo.db.test.ts.
// O vínculo de um PIX ou de uma linha de cartão só mostra rótulo (NF, número, cliente, valor, quem
// lançou) de registro que a Conta do grupo enxerga; o de outra Conta sai igual a um id inexistente (#128).
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { idDoInsert, semearContaBase, semearGrupo, semearModelo, semearUsuario, type Base } from '@/test/semear-conta'
import { semearOs, semearVendaMoto, semearVendaPeca } from '@/test/semear-alvos-conciliacao'

const url = process.env.TEST_DATABASE_URL
if (!url) throw new Error('TEST_DATABASE_URL não definida — este teste só roda num Postgres descartável')
if (!['localhost', '127.0.0.1'].includes(new URL(url).hostname)) {
  throw new Error('TEST_DATABASE_URL precisa ser loopback (Postgres descartável)')
}
process.env.DATABASE_URL = url

type Db = typeof import('@/lib/db')
type Tx = Parameters<Parameters<Db['db']['transaction']>[0]>[0]
let db: Db['db']
let rotulos: typeof import('@/lib/rotulos-alvo')
let conta: typeof import('@/lib/conta')

before(async () => {
  ;({ db } = await import('@/lib/db'))
  rotulos = await import('@/lib/rotulos-alvo')
  conta = await import('@/lib/conta')
})

after(async () => {
  await (globalThis as { __pgPool?: { end(): Promise<void> } }).__pgPool?.end()
})

class Desfazer extends Error {}

async function emTransacaoDesfeita(fn: (tx: Tx) => Promise<void>) {
  await assert.rejects(db.transaction(async tx => { await fn(tx); throw new Desfazer() }), Desfazer)
}

const PAGAMENTOS = [{ tipo: 'pix', valor: 1000 }]
const grupoDe = (b: Pick<Base, 'grupoId' | 'contaId'>) => ({ id: b.grupoId, contaId: b.contaId })

// Venda de moto com NF, o pedido dela, venda de peça e OS numa loja do grupo.
async function semearAlvos(tx: Tx, b: Pick<Base, 'lojaId'> & { prefixo: string }, usuarioId: string) {
  const balcao = { lojaId: b.lojaId, usuarioId, modeloId: await semearModelo(tx, `${b.prefixo}-${randomUUID()}`) }
  const venda = await semearVendaMoto(tx, balcao, PAGAMENTOS)
  const nf = String(Math.floor(Math.random() * 1e8))
  const pedido = await idDoInsert(tx, sql`update vendas set nota_fiscal_saida = ${nf} where id = ${venda} returning pedido_venda_id as id`)
  const peca = await semearVendaPeca(tx, balcao, PAGAMENTOS)
  const os = await semearOs(tx, balcao, PAGAMENTOS)
  return { venda, pedido, peca, os, nf }
}

async function semearConta(tx: Tx, nome: string) {
  const base = await semearContaBase(tx, { prefixo: 'ROT128', nome: `${nome}-${randomUUID()}`, cnpj: randomUUID() })
  const vendedor = await semearUsuario(tx, base, { papel: 'vendedor', rotulo: `vend-${randomUUID()}`, nomeDoUsuario: `Vendedor ${nome}`, comConta: true })
  return { base, vendedor, alvos: await semearAlvos(tx, base, vendedor) }
}

const idsPix = (a: Awaited<ReturnType<typeof semearAlvos>>) =>
  ({ vendaIds: [a.venda], osIds: [a.os], pedidoIds: [a.pedido], pecaVendaIds: [a.peca] })
const idsCartao = (a: Awaited<ReturnType<typeof semearAlvos>>) =>
  ({ vendaIds: [a.venda], pecaVendaIds: [a.peca], osIds: [a.os] })
const inexistentes = () => ({ vendaIds: [randomUUID()], osIds: [randomUUID()], pedidoIds: [randomUUID()], pecaVendaIds: [randomUUID()] })

// Os mapas como listas de ids: vazio = nada lido.
const chavesPix = (r: Awaited<ReturnType<typeof rotulos.rotulosDoVinculoPix>>) =>
  [r.nfDaVenda, r.numeroDaOs, r.numeroDoPedido, r.numeroDaPeca].map(m => [...m.keys()])
const chavesCartao = (r: Awaited<ReturnType<typeof rotulos.resumosDoAlvoCartao>>) =>
  [r.vendas, r.pecas, r.os].map(m => [...m.keys()])
const NADA_PIX = [[], [], [], []]
const NADA_CARTAO = [[], [], []]

test('guarda: a própria Conta vê NF, números, cliente e valor dos seus vínculos', async () => {
  await emTransacaoDesfeita(async tx => {
    const a = await semearConta(tx, 'A')
    const pix = await rotulos.rotulosDoVinculoPix(grupoDe(a.base), idsPix(a.alvos), tx)
    assert.equal(pix.nfDaVenda.get(a.alvos.venda), a.alvos.nf)
    assert.deepEqual(chavesPix(pix), [[a.alvos.venda], [a.alvos.os], [a.alvos.pedido], [a.alvos.peca]])
    const cartao = await rotulos.resumosDoAlvoCartao(grupoDe(a.base), idsCartao(a.alvos), tx)
    assert.equal(cartao.vendas.get(a.alvos.venda)?.clienteNome, 'Cliente sintético')
    assert.equal(cartao.vendas.get(a.alvos.venda)?.valor, '1000.00')
    assert.deepEqual(chavesCartao(cartao), [[a.alvos.venda], [a.alvos.peca], [a.alvos.os]])
  })
})

test('Conta B não lê rótulo de venda, pedido, peça nem OS da A: igual a id inexistente', async () => {
  await emTransacaoDesfeita(async tx => {
    const a = await semearConta(tx, 'A')
    const b = await semearConta(tx, 'B')
    assert.deepEqual(chavesPix(await rotulos.rotulosDoVinculoPix(grupoDe(b.base), idsPix(a.alvos), tx)), NADA_PIX)
    assert.deepEqual(chavesPix(await rotulos.rotulosDoVinculoPix(grupoDe(b.base), inexistentes(), tx)), NADA_PIX)
    assert.deepEqual(chavesCartao(await rotulos.resumosDoAlvoCartao(grupoDe(b.base), idsCartao(a.alvos), tx)), NADA_CARTAO)
    assert.deepEqual(chavesCartao(await rotulos.resumosDoAlvoCartao(grupoDe(b.base), inexistentes(), tx)), NADA_CARTAO)
  })
})

test('outro grupo da mesma Conta também não lê: o vínculo só aceita alvo das lojas do grupo', async () => {
  await emTransacaoDesfeita(async tx => {
    const a = await semearConta(tx, 'A')
    const outro = await semearGrupo(tx, a.base.contaId, { prefixo: 'ROT128', nome: `A2-${randomUUID()}`, cnpj: randomUUID() })
    const g2 = { id: outro.grupoId, contaId: a.base.contaId }
    assert.deepEqual(chavesPix(await rotulos.rotulosDoVinculoPix(g2, idsPix(a.alvos), tx)), NADA_PIX)
    assert.deepEqual(chavesCartao(await rotulos.resumosDoAlvoCartao(g2, idsCartao(a.alvos), tx)), NADA_CARTAO)
  })
})

test('OS do grupo com cliente de outra Conta mostra "Cliente não identificado", não o nome dele', async () => {
  await emTransacaoDesfeita(async tx => {
    const a = await semearConta(tx, 'A')
    const b = await semearConta(tx, 'B')
    const clienteB = await idDoInsert(tx, sql`insert into clientes (nome, conta_id) values ('Cliente da B', ${b.base.contaId}) returning id`)
    await tx.execute(sql`update ordens_servico set cliente_id = ${clienteB} where id = ${a.alvos.os}`)
    const cartao = await rotulos.resumosDoAlvoCartao(grupoDe(a.base), idsCartao(a.alvos), tx)
    assert.equal(cartao.os.get(a.alvos.os)?.clienteNome, 'Cliente não identificado')
  })
})

test('guarda: sem ids, nada é lido', async () => {
  await emTransacaoDesfeita(async tx => {
    const a = await semearConta(tx, 'A')
    assert.deepEqual(chavesPix(await rotulos.rotulosDoVinculoPix(grupoDe(a.base), { vendaIds: [], osIds: [], pedidoIds: [], pecaVendaIds: [] }, tx)), NADA_PIX)
    assert.deepEqual(chavesCartao(await rotulos.resumosDoAlvoCartao(grupoDe(a.base), { vendaIds: [], pecaVendaIds: [], osIds: [] }, tx)), NADA_CARTAO)
    assert.deepEqual([...(await conta.nomesDeUsuariosVisiveis(grupoDe(a.base), [], tx))], [])
  })
})

test('quem lançou: aparece o usuário da Conta (só loja, só Conta) e o admin_geral', async () => {
  await emTransacaoDesfeita(async tx => {
    const a = await semearConta(tx, 'A')
    const soLoja = await semearUsuario(tx, a.base, { papel: 'aux_adm', rotulo: `loja-${randomUUID()}`, nomeDoUsuario: 'Só loja' })
    const soConta = await semearUsuario(tx, a.base, { papel: 'admin_socio', rotulo: `socio-${randomUUID()}`, nomeDoUsuario: 'Só Conta', semLoja: true, comConta: true })
    const geral = await semearUsuario(tx, a.base, { papel: 'admin_geral', rotulo: `geral-${randomUUID()}`, nomeDoUsuario: 'Geral', semLoja: true })
    const nomes = await conta.nomesDeUsuariosVisiveis(grupoDe(a.base), [soLoja, soConta, geral], tx)
    assert.deepEqual([soLoja, soConta, geral].map(id => nomes.get(id)), ['Só loja', 'Só Conta', 'Geral'])
  })
})

test('quem lançou: usuário de outra Conta não aparece, nem marcando o grupo em grupos_acesso; igual a inexistente', async () => {
  await emTransacaoDesfeita(async tx => {
    const a = await semearConta(tx, 'A')
    const b = await semearConta(tx, 'B')
    const marcaGrupoA = await semearUsuario(tx, b.base, { papel: 'aux_adm', rotulo: `marca-${randomUUID()}`, semLoja: true })
    await tx.execute(sql`update usuarios set grupos_acesso = array[${a.base.grupoId}]::uuid[] where id = ${marcaGrupoA}`)
    const nomes = await conta.nomesDeUsuariosVisiveis(grupoDe(a.base), [b.vendedor, marcaGrupoA, randomUUID()], tx)
    assert.deepEqual([...nomes], [])
  })
})

test('quem lançou: admin_rede de outra Conta aparece com o grupo liberado, inclusive revogado; liberado em outro grupo, não', async () => {
  await emTransacaoDesfeita(async tx => {
    const a = await semearConta(tx, 'A')
    const b = await semearConta(tx, 'B')
    const geral = await semearUsuario(tx, a.base, { papel: 'admin_geral', rotulo: `geral-${randomUUID()}`, semLoja: true })
    const rede = (rotulo: string) => semearUsuario(tx, b.base, { papel: 'admin_rede', rotulo: `${rotulo}-${randomUUID()}`, nomeDoUsuario: rotulo, semLoja: true, comConta: true })
    const [vivo, revogado, deOutroGrupo] = [await rede('Vivo'), await rede('Revogado'), await rede('Outro grupo')]
    const outro = await semearGrupo(tx, a.base.contaId, { prefixo: 'ROT128', nome: `A2-${randomUUID()}`, cnpj: randomUUID() })
    const liberar = (usuario: string, grupo: string, revogadoEm: string | null) => tx.execute(sql`
      insert into grupos_liberados (usuario_id, grupo_id, liberado_por, revogado_em) values (${usuario}, ${grupo}, ${geral}, ${revogadoEm}::timestamptz)`)
    await liberar(vivo, a.base.grupoId, null)
    await liberar(revogado, a.base.grupoId, '2026-11-01T12:00:00Z')
    await liberar(deOutroGrupo, outro.grupoId, null)
    const nomes = await conta.nomesDeUsuariosVisiveis(grupoDe(a.base), [vivo, revogado, deOutroGrupo], tx)
    assert.deepEqual([vivo, revogado, deOutroGrupo].map(id => nomes.get(id) ?? null), ['Vivo', 'Revogado', null])
  })
})
