// Teste de banco: forçar e desfazer a conciliação de um pagamento (#79) pelas Server Actions de
// verdade, contra o Postgres descartável. Só a fronteira de fora é simulada: sessão, cookie do
// grupo ativo e revalidatePath. O admin_rede vem do `usuarioDaRede` real, como em produção.
import { after, afterEach, before, mock, test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { semearContaBase, semearUsuario, type Base } from '@/test/semear-conta'
import type { AlvoConciliacao } from './actions'

const url = process.env.TEST_DATABASE_URL
if (!url || !['localhost', '127.0.0.1'].includes(new URL(url).hostname)) throw new Error('Use somente Postgres descartável local')
process.env.DATABASE_URL = url

type Db = typeof import('@/lib/db')
type Sessao = { id: string; nome: string; papel: string; lojaId: string | null; contaId: string | null; gruposAcesso: string[]; gruposAprovacao: string[] }
let db: Db['db']
let actions: typeof import('./actions')
let usuario: Sessao
let grupoAtivoNoCookie: string | null = null

const authMock = mock.module('@/lib/auth', { namedExports: { getUsuarioLogado: async () => usuario } })
const cacheMock = mock.module('next/cache', { namedExports: { revalidatePath: () => {} } })
const headersMock = mock.module('next/headers', {
  namedExports: { cookies: async () => ({ get: (n: string) => (n === 'grupoAtivo' && grupoAtivoNoCookie ? { value: grupoAtivoNoCookie } : undefined) }) },
})

before(async () => {
  ;({ db } = await import('@/lib/db'))
  actions = await import('./actions')
})
afterEach(() => { grupoAtivoNoCookie = null })
after(async () => {
  authMock.restore(); cacheMock.restore(); headersMock.restore()
  await (globalThis as { __pgPool?: { end(): Promise<void> } }).__pgPool?.end()
})

async function linhas<T>(q: ReturnType<typeof sql>): Promise<T[]> {
  return ((await db.execute(q)) as unknown as { rows: T[] }).rows
}
const idDe = async (q: ReturnType<typeof sql>) => (await linhas<{ id: string }>(q))[0].id

// PIX pendente na posição 0 e dinheiro (não concilia) na 1.
const PAGAMENTOS = JSON.stringify([{ tipo: 'pix', valor: 1000 }, { tipo: 'dinheiro', valor: 200 }])
const MOTIVO = 'PIX caiu na conta pessoal'

type Alvos = Record<AlvoConciliacao['tipo'], string>

// Conta nova com uma venda de moto, uma OS e uma venda de peça, todas com PAGAMENTOS.
async function contaComAlvos(): Promise<Base & { alvos: Alvos }> {
  const suf = randomUUID()
  const base = await semearContaBase(db, { prefixo: 'FC79', nome: suf, cnpj: suf })
  const vendedor = await semearUsuario(db, base, { papel: 'vendedor' })
  const modelo = await idDe(sql`insert into modelos (marca, modelo, categoria, potencia_w, motor, velocidade_max)
    values ('M', ${'FC79 ' + suf}, 'autopropelido', '1000', 'hub', '32') returning id`)
  const moto = await idDe(sql`insert into motos (chassi, modelo_id, loja_id, cor, nota_fiscal_entrada, status, disponibilidade)
    values (${randomUUID()}, ${modelo}, ${base.lojaId}, 'CINZA', '1', 'vendida', 'vendida') returning id`)
  const pedido = await idDe(sql`insert into pedidos_venda (moto_id, loja_id, vendedor_id) values (${moto}, ${base.lojaId}, ${vendedor}) returning id`)
  const vendaMoto = await idDe(sql`insert into vendas (pedido_venda_id, moto_id, loja_id, vendedor_id, efetivado_por, cliente_nome, cliente_cpf, valor, forma_pagamento, pagamentos)
    values (${pedido}, ${moto}, ${base.lojaId}, ${vendedor}, ${vendedor}, 'Cliente sintético', '52998224725', 1200, 'pix', ${PAGAMENTOS}::jsonb) returning id`)
  const os = await idDe(sql`insert into ordens_servico (loja_id, aberta_por, descricao, pagamentos)
    values (${base.lojaId}, ${vendedor}, 'revisão', ${PAGAMENTOS}::jsonb) returning id`)
  const peca = await idDe(sql`insert into vendas_pecas (loja_id, vendedor_id, forma_pagamento, pagamentos, valor_total)
    values (${base.lojaId}, ${vendedor}, 'pix', ${PAGAMENTOS}::jsonb, 1200) returning id`)
  return { ...base, alvos: { moto: vendaMoto, os, peca } }
}

const TABELA: Record<AlvoConciliacao['tipo'], string> = { moto: 'vendas', os: 'ordens_servico', peca: 'vendas_pecas' }
type Pgto = { tipo: string; valor: number; conciliadoManual?: { motivo: string; porId: string; porNome: string; em: string } }
const pagamentosDe = async (tipo: AlvoConciliacao['tipo'], id: string) =>
  (await linhas<{ pagamentos: Pgto[] }>(sql`select pagamentos from ${sql.raw(TABELA[tipo])} where id = ${id}`))[0].pagamentos

const sessao = (b: Base, papel: string, extra: Partial<Sessao> = {}): Sessao =>
  ({ id: randomUUID(), nome: `${papel} de teste`, papel, lojaId: b.lojaId, contaId: b.contaId, gruposAcesso: [], gruposAprovacao: [], ...extra })

const TIPOS = ['moto', 'os', 'peca'] as const

test('aux_adm e admin_socio forçam e desfazem o PIX pendente da venda de moto, da OS e da venda de peça', async () => {
  const a = await contaComAlvos()
  for (const papel of ['aux_adm', 'admin_socio']) {
    usuario = sessao(a, papel)
    for (const tipo of TIPOS) {
      const alvo = { tipo, id: a.alvos[tipo] }
      assert.deepEqual(await actions.forcarConciliacaoAction(alvo, 0, MOTIVO), { ok: true, dados: undefined }, `${papel} força ${tipo}`)
      const [pix, dinheiro] = await pagamentosDe(tipo, alvo.id)
      assert.deepEqual({ ...pix.conciliadoManual, em: undefined }, { motivo: MOTIVO, porId: usuario.id, porNome: usuario.nome, em: undefined }, `${papel} em ${tipo}`)
      assert.deepEqual(dinheiro, { tipo: 'dinheiro', valor: 200 })

      assert.deepEqual(await actions.desfazerConciliacaoForcadaAction(alvo, 0), { ok: true, dados: undefined }, `${papel} desfaz ${tipo}`)
      assert.deepEqual(await pagamentosDe(tipo, alvo.id), JSON.parse(PAGAMENTOS))
    }
  }
})

test('admin_geral segue forçando e desfazendo no grupo ativo (sem vermelho: já valia)', async () => {
  const a = await contaComAlvos()
  usuario = sessao(a, 'admin_geral', { lojaId: null, contaId: null })
  grupoAtivoNoCookie = a.grupoId
  const alvo = { tipo: 'peca' as const, id: a.alvos.peca }
  assert.equal((await actions.forcarConciliacaoAction(alvo, 0, MOTIVO)).ok, true)
  assert.equal((await pagamentosDe('peca', alvo.id))[0].conciliadoManual?.porId, usuario.id)
  assert.equal((await actions.desfazerConciliacaoForcadaAction(alvo, 0)).ok, true)
  assert.deepEqual(await pagamentosDe('peca', alvo.id), JSON.parse(PAGAMENTOS))
})

test('vendedor e mecânico não forçam nem desfazem, nem na própria loja (sem vermelho: a recusa já valia)', async () => {
  const a = await contaComAlvos()
  for (const papel of ['vendedor', 'mecanico']) {
    usuario = sessao(a, papel)
    for (const tipo of TIPOS) {
      const alvo = { tipo, id: a.alvos[tipo] }
      assert.deepEqual(await actions.forcarConciliacaoAction(alvo, 0, MOTIVO), { ok: false, erro: 'Sem permissão' }, `${papel} força ${tipo}`)
      assert.deepEqual(await actions.desfazerConciliacaoForcadaAction(alvo, 0), { ok: false, erro: 'Sem permissão' }, `${papel} desfaz ${tipo}`)
      assert.deepEqual(await pagamentosDe(tipo, alvo.id), JSON.parse(PAGAMENTOS))
    }
  }
})

test('motivo curto e pagamento que não concilia são recusados com a frase e nada grava (sem vermelho: a recusa já valia)', async () => {
  const a = await contaComAlvos()
  usuario = sessao(a, 'aux_adm')
  const alvo = { tipo: 'moto' as const, id: a.alvos.moto }
  assert.deepEqual(await actions.forcarConciliacaoAction(alvo, 0, ' ok '), { ok: false, erro: 'Informe o motivo da conciliação forçada' })
  assert.deepEqual(await actions.forcarConciliacaoAction(alvo, 1, MOTIVO), { ok: false, erro: 'Esse pagamento não precisa de conciliação' })
  assert.deepEqual(await pagamentosDe('moto', alvo.id), JSON.parse(PAGAMENTOS))
})
