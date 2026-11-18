// Painel de aprovações em /vendas (#25, 25b): aparece para quem pode aprovar no grupo ativo (ponto 3 do Luis), não só para
// admin_geral e admin_socio. Persona real (review.md): admin_rede com o grupo em grupos_aprovacao, sem ele, e aux_adm.
import { after, before, mock, test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { semearContaBase, semearUsuario, type Base } from '@/test/semear-conta'

const url = process.env.TEST_DATABASE_URL
if (!url || !['localhost', '127.0.0.1'].includes(new URL(url).hostname)) throw new Error('Use somente Postgres descartável local')
process.env.DATABASE_URL = url

// O grupo ativo do sócio (e da persona do admin_rede) vem do cookie; sem cookie, o da própria loja.
let grupoDoCookie: string | undefined
const cookiesMock = mock.module('next/headers', { namedExports: { cookies: async () => ({ get: () => (grupoDoCookie ? { value: grupoDoCookie } : undefined) }) } })

type Db = typeof import('@/lib/db')
let db: Db['db']
let execRows: Db['execRows']
let aprovacoesDoPainel: typeof import('@/lib/aprovacoes-do-painel')['aprovacoesDoPainel']
let usuarioDaRede: typeof import('@/lib/grupos-liberados')['usuarioDaRede']

before(async () => {
  ;({ db, execRows } = await import('@/lib/db'))
  ;({ aprovacoesDoPainel } = await import('@/lib/aprovacoes-do-painel'))
  ;({ usuarioDaRede } = await import('@/lib/grupos-liberados'))
})
after(async () => {
  cookiesMock.restore()
  await (globalThis as { __pgPool?: { end(): Promise<void> } }).__pgPool?.end()
})

const idDe = async (q: ReturnType<typeof sql>) => (await execRows(q))[0].id as string

async function semearConta() {
  const sufixo = randomUUID()
  const base = await semearContaBase(db, { prefixo: 'AP25B', nome: sufixo, cnpj: sufixo })
  const vendedorId = await semearUsuario(db, base, { papel: 'vendedor', rotulo: 'vend', comConta: true })
  const modeloId = await idDe(sql`insert into modelos (marca, modelo, categoria, potencia_w, motor, velocidade_max)
    values ('M', ${'AP25B ' + sufixo}, 'autopropelido', '1000', 'hub', '32') returning id`)
  const motoId = await idDe(sql`insert into motos (chassi, modelo_id, loja_id, cor, nota_fiscal_entrada, status, disponibilidade)
    values (${randomUUID()}, ${modeloId}, ${base.lojaId}, 'CINZA', '1', 'montada', 'aguardando_aprovacao') returning id`)
  const aprovacaoId = await idDe(sql`insert into aprovacoes_venda (origem, moto_id, loja_id, vendedor_id, valor, dados_venda, motivo)
    values ('pedido', ${motoId}, ${base.lojaId}, ${vendedorId}, '9000', ${JSON.stringify({ pedidoId: randomUUID(), numero: 1 })}::jsonb, 'Cliente fiel') returning id`)
  return { base, aprovacaoId }
}

/** Usuário como o getUsuarioLogado entrega: o admin_rede passa pelo usuarioDaRede (vira admin_socio; no grupo liberado ativo, a persona). */
async function usuario(base: Base, papel: string, o: { gruposAprovacao?: string[]; liberado?: Base } = {}) {
  const id = await semearUsuario(db, base, { papel, rotulo: `${papel}-${randomUUID()}`, comConta: true })
  const gruposAprovacao = o.gruposAprovacao ?? []
  const cru = { id, papel, email: `${id}@teste.invalid`, lojaId: base.lojaId, contaId: base.contaId, gruposAcesso: [] as string[], gruposAprovacao, aprovaPagamentoSensivel: false }
  grupoDoCookie = o.liberado?.grupoId
  return usuarioDaRede(cru, o.liberado ? [{ grupoId: o.liberado.grupoId, contaId: o.liberado.contaId }] : [], grupoDoCookie ?? null)
}

test('admin_rede em casa vê as aprovações do próprio grupo e aprova, como o sócio; o aux_adm não recebe nada', async () => {
  const a = await semearConta()
  const emCasa = await aprovacoesDoPainel(await usuario(a.base, 'admin_rede'))
  assert.deepEqual([emCasa.aprovacoes.map(x => x.id), emCasa.podeAprovarValorMinimo], [[a.aprovacaoId], true])
  assert.deepEqual(await aprovacoesDoPainel(await usuario(a.base, 'aux_adm')), { aprovacoes: [], podeAprovarValorMinimo: false, podeAprovarSensivel: false })
})

test('admin_rede de outra Conta com o grupo liberado ativo vê as aprovações dele; aprova só se o grupo foi marcado para aprovar', async () => {
  const a = await semearConta()
  const rede = await semearConta()
  const marcado = await aprovacoesDoPainel(await usuario(rede.base, 'admin_rede', { liberado: a.base, gruposAprovacao: [a.base.grupoId] }))
  assert.deepEqual([marcado.aprovacoes.map(x => x.id), marcado.podeAprovarValorMinimo], [[a.aprovacaoId], true])
  const semMarca = await aprovacoesDoPainel(await usuario(rede.base, 'admin_rede', { liberado: a.base }))
  assert.deepEqual([semMarca.aprovacoes.map(x => x.id), semMarca.podeAprovarValorMinimo], [[a.aprovacaoId], false])
  grupoDoCookie = undefined
})

test('o sócio vê as do próprio grupo e nunca as de outra Conta, mesmo com o grupo de lá nos grupos de aprovação', async () => {
  const a = await semearConta()
  const b = await semearConta()
  const r = await aprovacoesDoPainel(await usuario(a.base, 'admin_socio', { gruposAprovacao: [b.base.grupoId] }))
  assert.deepEqual([r.aprovacoes.map(x => x.id), r.podeAprovarValorMinimo], [[a.aprovacaoId], true])
})
