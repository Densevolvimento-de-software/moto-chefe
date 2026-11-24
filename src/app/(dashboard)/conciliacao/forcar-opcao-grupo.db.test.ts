// Teste de banco: quem pode forçar e desfazer a conciliação quando a opção do grupo da loja do registro
// (grupos.aux_adm_pode_forcar_conciliacao, #220) está desligada. Pelas Server Actions de verdade, contra o
// Postgres descartável; só sessão, cookie do grupo ativo e revalidatePath são simulados.
import { after, afterEach, before, mock, test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { semearGrupo } from '@/test/semear-conta'
import { semearContaComAlvos, semearLinhaDaMaquininha, semearPixRecebido } from '@/test/semear-alvos-conciliacao'
import { sessaoDe, type Sessao } from '@/test/sessao'
import { COMPLETA_FORCADA, COMPLETA_FORCADA_PEDIR_A_GESTOR } from '@/lib/conciliacao-status'
import type { PgtoOS } from '@/lib/conciliacao-status'

const url = process.env.TEST_DATABASE_URL
if (!url || !['localhost', '127.0.0.1'].includes(new URL(url).hostname)) throw new Error('Use somente Postgres descartável local')
process.env.DATABASE_URL = url

type Db = typeof import('@/lib/db')
let db: Db['db']
let execRows: Db['execRows']
let actions: typeof import('./actions')
let pixMcp: typeof import('../pix-mcp/actions')
let usuario: Sessao
let grupoAtivoNoCookie: string | null = null

const authMock = mock.module('@/lib/auth', { namedExports: { getUsuarioLogado: async () => usuario } })
const cacheMock = mock.module('next/cache', { namedExports: { revalidatePath: () => {} } })
const headersMock = mock.module('next/headers', {
  namedExports: { cookies: async () => ({ get: (n: string) => (n === 'grupoAtivo' && grupoAtivoNoCookie ? { value: grupoAtivoNoCookie } : undefined) }) },
})

before(async () => {
  ;({ db, execRows } = await import('@/lib/db'))
  actions = await import('./actions')
  pixMcp = await import('../pix-mcp/actions')
})
afterEach(() => { grupoAtivoNoCookie = null })
after(async () => {
  authMock.restore(); cacheMock.restore(); headersMock.restore()
  await (globalThis as { __pgPool?: { end(): Promise<void> } }).__pgPool?.end()
})

const TABELA = { moto: 'vendas', os: 'ordens_servico', peca: 'vendas_pecas' } as const
const ALVOS = ['moto', 'os', 'peca'] as const
const FRASE_DE_ALVO = { moto: 'Venda não encontrada', os: 'Ordem de serviço não encontrada', peca: 'Venda de peça não encontrada' } as const
const SEM_PERMISSAO = { ok: false, erro: 'Sem permissão' }
const MOTIVO = 'PIX caiu na conta pessoal'
const ENTROU = 998
// Pagamento pendente (pix) na posição 0 e dinheiro (não concilia) na 1.
const PAGAMENTOS: PgtoOS[] = [{ tipo: 'pix', valor: 1000 }, { tipo: 'dinheiro', valor: 200 }]

const vendaDoPix = async (pixId: string) => (await execRows(sql`select venda_id from pix_recebimentos_mcp where id = ${pixId}`))[0].venda_id
const vendaDaLinha = async (linhaId: string) => (await execRows(sql`select venda_id from conciliacoes_cartao where id = ${linhaId}`))[0].venda_id
const pagamentosDe = async (tipo: (typeof ALVOS)[number], id: string): Promise<PgtoOS[]> =>
  (await execRows(sql`select pagamentos from ${sql.raw(TABELA[tipo])} where id = ${id}`))[0].pagamentos
const sessao = (b: { lojaId: string; contaId: string }, papel: string, extra: Partial<Sessao> = {}): Sessao =>
  sessaoDe(b, papel, randomUUID(), extra)

// Conta com venda de moto, OS e venda de peça pendentes, e a opção do grupo na posição pedida.
async function contaComOpcao(ligada: boolean) {
  const suf = randomUUID()
  const a = await semearContaComAlvos(db, 'FC220', PAGAMENTOS)
  await db.execute(sql`update grupos set aux_adm_pode_forcar_conciliacao = ${ligada} where id = ${a.grupoId}`)
  return { ...a, suf }
}

// Forçar e desfazer de verdade pelo admin_socio (que sempre pode), para o aux_adm tentar mexer depois.
async function forcadoPeloSocio(a: Awaited<ReturnType<typeof contaComOpcao>>, tipo: (typeof ALVOS)[number]) {
  usuario = sessao(a, 'admin_socio')
  const alvo = { tipo, id: a.alvos[tipo] }
  assert.equal((await actions.forcarConciliacaoAction(alvo, 0, MOTIVO, ENTROU, 1000)).ok, true, `sócio força ${tipo}`)
  return alvo
}

// Pix de 1.000 na venda de moto com forçada parcial de 600 (o banco não viu o resto, de 400).
async function forcadaParcialDeSeiscentos(a: Awaited<ReturnType<typeof contaComOpcao>>) {
  const marca = { motivo: 'Resto caiu na conta pessoal', porId: 'u1', porNome: 'Gestor', em: '2026-11-19T12:00:00.000Z',
    pix: { valorRecebido: 600, valorBruto: 600, custoPix: 0, custoPixTaxa: 0 } }
  await db.execute(sql`update vendas set pagamentos = ${JSON.stringify([{ tipo: 'pix', valor: 1000, conciliadoManual: marca }])}::jsonb where id = ${a.alvos.moto}`)
}

// PIX do banco de 400, ligado à venda de moto, que completa a forçada parcial (o item que o desvincular solta).
async function pixQueCompletaForcada(a: Awaited<ReturnType<typeof contaComOpcao>>) {
  await forcadaParcialDeSeiscentos(a)
  return semearPixRecebido(db, a.grupoId, { valor: 400, vinculado: { venda: a.alvos.moto, valorBruto: 400, custoPix: 0 } })
}

// Linha da maquininha pix de 400 ligada à venda de moto: a única que completa a forçada parcial.
async function linhaQueCompletaForcada(a: Awaited<ReturnType<typeof contaComOpcao>>) {
  await forcadaParcialDeSeiscentos(a)
  return semearLinhaDaMaquininha(db, a.grupoId, { valor: 400, alvo: { tipo: 'moto', id: a.alvos.moto } })
}

// ─── B1: a coluna nova ──────────────────────────────────────────────────────────────────────────────

test('B1: grupo criado sem informar a opção fica com ela ligada (default true)', async () => {
  const suf = randomUUID()
  const a = await contaComOpcao(true)
  const novo = await semearGrupo(db, a.contaId, { prefixo: 'FC220', nome: suf, cnpj: suf })
  const [linha] = await execRows(sql`select aux_adm_pode_forcar_conciliacao as v from grupos where id = ${novo.grupoId}`) as { v: boolean }[]
  assert.equal(linha.v, true)
})

// ─── B2: forçar ────────────────────────────────────────────────────────────────────────────────────

test('B2: aux_adm de grupo com a opção desligada chamando forçar direto recebe Sem permissão nos 3 alvos e nada grava', async () => {
  const a = await contaComOpcao(false)
  usuario = sessao(a, 'aux_adm')
  for (const tipo of ALVOS) {
    const alvo = { tipo, id: a.alvos[tipo] }
    assert.deepEqual(await actions.forcarConciliacaoAction(alvo, 0, MOTIVO, ENTROU, 1000), SEM_PERMISSAO, `forçar ${tipo}`)
    assert.deepEqual(await pagamentosDe(tipo, alvo.id), PAGAMENTOS, `${tipo}: pagamentos iguais ao de antes`)
  }
})

// ─── B3: desfazer forçada do alvo ──────────────────────────────────────────────────────────────────

test('B3: aux_adm de grupo desligado não desfaz a forçada que o sócio fez; a marca continua', async () => {
  const a = await contaComOpcao(false)
  for (const tipo of ALVOS) {
    const alvo = await forcadoPeloSocio(a, tipo)
    const antes = await pagamentosDe(tipo, alvo.id)
    usuario = sessao(a, 'aux_adm')
    assert.deepEqual(await actions.desfazerConciliacaoForcadaAction(alvo, 0), SEM_PERMISSAO, `desfazer ${tipo}`)
    assert.deepEqual(await pagamentosDe(tipo, alvo.id), antes, `${tipo}: marca continua`)
  }
})

// ─── B4: desfazer forçada parcial pela linha de cartão (/conciliacao) ──────────────────────────────

test('B4: aux_adm de grupo desligado não desfaz a forçada parcial pela linha de cartão; linha continua vinculada', async () => {
  const a = await contaComOpcao(false)
  const linha = await linhaQueCompletaForcada(a)
  const antes = await pagamentosDe('moto', a.alvos.moto)
  usuario = sessao(a, 'aux_adm')
  assert.deepEqual(await actions.desfazerForcadaEDesvincularLinhaAction(linha, null), SEM_PERMISSAO)
  assert.equal(await vendaDaLinha(linha), a.alvos.moto)
  assert.deepEqual(await pagamentosDe('moto', a.alvos.moto), antes, 'a forçada parcial continua na venda')
})

// ─── B5: desfazer forçada parcial pela /pix-mcp ────────────────────────────────────────────────────

test('B5: aux_adm de grupo desligado não desfaz a forçada pela /pix-mcp; o PIX continua vinculado', async () => {
  const a = await contaComOpcao(false)
  const pix = await pixQueCompletaForcada(a)
  const antes = await pagamentosDe('moto', a.alvos.moto)
  usuario = sessao(a, 'aux_adm')
  assert.deepEqual(await pixMcp.desfazerForcadaERemoverAction(pix, null), SEM_PERMISSAO)
  assert.equal(await vendaDoPix(pix), a.alvos.moto)
  assert.deepEqual(await pagamentosDe('moto', a.alvos.moto), antes, 'a forçada parcial continua na venda')
})

// ─── B6: frase do desvincular que completa forçada ─────────────────────────────────────────────────

test('B6: aux_adm de grupo desligado desvinculando o PIX da /pix-mcp recebe a frase de pedir ao gestor', async () => {
  const a = await contaComOpcao(false)
  const pix = await pixQueCompletaForcada(a)
  const antes = await pagamentosDe('moto', a.alvos.moto)
  usuario = sessao(a, 'aux_adm')
  assert.deepEqual(await pixMcp.removerCorrespondenciaAction(pix), { ok: false, erro: COMPLETA_FORCADA_PEDIR_A_GESTOR })
  assert.equal(await vendaDoPix(pix), a.alvos.moto)
  assert.deepEqual(await pagamentosDe('moto', a.alvos.moto), antes)
})

test('B6b: aux_adm de grupo desligado desvinculando a linha de cartão da /conciliacao recebe a frase de pedir ao gestor', async () => {
  const a = await contaComOpcao(false)
  const linha = await linhaQueCompletaForcada(a)
  const antes = await pagamentosDe('moto', a.alvos.moto)
  usuario = sessao(a, 'aux_adm')
  assert.deepEqual(await actions.desvincularVendaAction(linha), { ok: false, erro: COMPLETA_FORCADA_PEDIR_A_GESTOR })
  assert.equal(await vendaDaLinha(linha), a.alvos.moto)
  assert.deepEqual(await pagamentosDe('moto', a.alvos.moto), antes)
})

test('B6c: aux_adm de grupo desligado desvinculando o PIX pela /conciliacao recebe a frase de pedir ao gestor', async () => {
  const a = await contaComOpcao(false)
  const pix = await pixQueCompletaForcada(a)
  const antes = await pagamentosDe('moto', a.alvos.moto)
  usuario = sessao(a, 'aux_adm')
  assert.deepEqual(await actions.desvincularPixAlvoAction(pix), { ok: false, erro: COMPLETA_FORCADA_PEDIR_A_GESTOR })
  assert.equal(await vendaDoPix(pix), a.alvos.moto)
  assert.deepEqual(await pagamentosDe('moto', a.alvos.moto), antes)
})

test('B6d: aux_adm de grupo ligado recebe a frase que manda desfazer a forçada (comportamento de hoje)', async () => {
  const a = await contaComOpcao(true)
  const pix = await pixQueCompletaForcada(a)
  usuario = sessao(a, 'aux_adm')
  assert.deepEqual(await pixMcp.removerCorrespondenciaAction(pix), { ok: false, erro: COMPLETA_FORCADA })
})

// ─── B7: guarda, passa hoje. O grupo ativo de um aux_adm é o da própria loja (o cookie não o muda), então
// registro de outro grupo da Conta é "não encontrado", ligada ou desligada a opção de cada um.
test('B7 (guarda): aux_adm do grupo ligado não força registro do grupo desligado da mesma Conta: recusa como inexistente', async () => {
  const a = await contaComOpcao(false)
  const suf = randomUUID()
  const ligado = await semearGrupo(db, a.contaId, { prefixo: 'FC220', nome: suf, cnpj: suf })
  await db.execute(sql`update grupos set aux_adm_pode_forcar_conciliacao = true where id = ${ligado.grupoId}`)
  usuario = sessao({ lojaId: ligado.lojaId, contaId: a.contaId }, 'aux_adm')
  for (const tipo of ALVOS) {
    assert.deepEqual(await actions.forcarConciliacaoAction({ tipo, id: a.alvos[tipo] }, 0, MOTIVO, ENTROU, 1000), { ok: false, erro: FRASE_DE_ALVO[tipo] }, tipo)
    assert.deepEqual(await pagamentosDe(tipo, a.alvos[tipo]), PAGAMENTOS)
  }
})

// ─── B8: isolamento A x B: a Conta B não sabe que o registro da Conta A existe ─────────────────────

test('B8: aux_adm da Conta B, com o grupo dela desligado ou ligado, recebe a frase de inexistente no registro da Conta A', async () => {
  const a = await contaComOpcao(false)
  const b = await contaComOpcao(false)
  const bLigada = await contaComOpcao(true)
  for (const outra of [b, bLigada]) {
    usuario = sessao(outra, 'aux_adm')
    for (const tipo of ALVOS) {
      const doA = await actions.forcarConciliacaoAction({ tipo, id: a.alvos[tipo] }, 0, MOTIVO, ENTROU, 1000)
      const inexistente = await actions.forcarConciliacaoAction({ tipo, id: randomUUID() }, 0, MOTIVO, ENTROU, 1000)
      assert.deepEqual(doA, { ok: false, erro: FRASE_DE_ALVO[tipo] }, `${tipo} da Conta A`)
      assert.deepEqual(doA, inexistente, `${tipo}: mesma resposta que inexistente`)
    }
    assert.deepEqual(await pagamentosDe('moto', a.alvos.moto), PAGAMENTOS)
  }
})

// ─── B9 e B10: regressões, quem pode continua podendo ──────────────────────────────────────────────

test('B9: admin_socio força e desfaz no grupo com a opção desligada', async () => {
  const a = await contaComOpcao(false)
  usuario = sessao(a, 'admin_socio')
  for (const tipo of ALVOS) {
    const alvo = { tipo, id: a.alvos[tipo] }
    assert.equal((await actions.forcarConciliacaoAction(alvo, 0, MOTIVO, ENTROU, 1000)).ok, true, `força ${tipo}`)
    assert.equal((await actions.desfazerConciliacaoForcadaAction(alvo, 0)).ok, true, `desfaz ${tipo}`)
    assert.deepEqual(await pagamentosDe(tipo, alvo.id), PAGAMENTOS)
  }
})

test('B10: aux_adm força e desfaz no grupo com a opção ligada (como hoje)', async () => {
  const a = await contaComOpcao(true)
  usuario = sessao(a, 'aux_adm')
  for (const tipo of ALVOS) {
    const alvo = { tipo, id: a.alvos[tipo] }
    assert.equal((await actions.forcarConciliacaoAction(alvo, 0, MOTIVO, ENTROU, 1000)).ok, true, `força ${tipo}`)
    assert.equal((await actions.desfazerConciliacaoForcadaAction(alvo, 0)).ok, true, `desfaz ${tipo}`)
    assert.deepEqual(await pagamentosDe(tipo, alvo.id), PAGAMENTOS)
  }
})
