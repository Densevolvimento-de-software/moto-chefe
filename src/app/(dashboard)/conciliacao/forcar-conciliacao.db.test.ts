// Teste de banco: forçar e desfazer a conciliação de um pagamento (#79) pelas Server Actions de
// verdade, contra o Postgres descartável. Só a fronteira de fora é simulada: sessão, cookie do
// grupo ativo e revalidatePath. O admin_rede vem do `usuarioDaRede` real, como em produção.
import { after, afterEach, before, mock, test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { semearGrupo, semearLoja, type Base } from '@/test/semear-conta'
import { semearContaComAlvos, semearPixRecebido, semearVendaPeca } from '@/test/semear-alvos-conciliacao'
import { ALVO_TIPOS } from '@/lib/conciliacao-alvo'
import type { AlvoConciliacao } from './actions'
import type { PgtoOS } from '@/lib/conciliacao-status'
import { sessaoDe, type Sessao } from '@/test/sessao'

const url = process.env.TEST_DATABASE_URL
if (!url || !['localhost', '127.0.0.1'].includes(new URL(url).hostname)) throw new Error('Use somente Postgres descartável local')
process.env.DATABASE_URL = url

type Db = typeof import('@/lib/db')
let db: Db['db']
let execRows: Db['execRows']
let actions: typeof import('./actions')
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
})
afterEach(() => { grupoAtivoNoCookie = null })
after(async () => {
  authMock.restore(); cacheMock.restore(); headersMock.restore()
  await (globalThis as { __pgPool?: { end(): Promise<void> } }).__pgPool?.end()
})

// PIX pendente na posição 0 e dinheiro (não concilia) na 1.
const PAGAMENTOS = [{ tipo: 'pix', valor: 1000 }, { tipo: 'dinheiro', valor: 200 }]
const MOTIVO = 'PIX caiu na conta pessoal'
// Forçar PIX pede o valor que entrou na conta (#92): 998 de 1000 dá custo 2.
const ENTROU = 998
const PIX_DA_MARCA = { valorRecebido: 998, valorBruto: 1000, custoPix: 2, custoPixTaxa: 0.002 }

type Alvos = Record<AlvoConciliacao['tipo'], string>

const contaComAlvos = () => semearContaComAlvos(db, 'FC79', PAGAMENTOS)

const TABELA: Record<AlvoConciliacao['tipo'], string> = { moto: 'vendas', os: 'ordens_servico', peca: 'vendas_pecas' }
const pagamentosDe = async (tipo: AlvoConciliacao['tipo'], id: string): Promise<PgtoOS[]> =>
  (await execRows(sql`select pagamentos from ${sql.raw(TABELA[tipo])} where id = ${id}`))[0].pagamentos

const sessao = (b: Base, papel: string, extra: Partial<Sessao> = {}): Sessao =>
  sessaoDe(b, papel, randomUUID(), extra)

const TIPOS = ALVO_TIPOS

test('aux_adm e admin_socio forçam e desfazem o PIX pendente da venda de moto, da OS e da venda de peça', async () => {
  const a = await contaComAlvos()
  for (const papel of ['aux_adm', 'admin_socio']) {
    usuario = sessao(a, papel)
    for (const tipo of TIPOS) {
      const alvo = { tipo, id: a.alvos[tipo] }
      assert.deepEqual(await actions.forcarConciliacaoAction(alvo, 0, MOTIVO, ENTROU), { ok: true, dados: undefined }, `${papel} força ${tipo}`)
      const [pix, dinheiro] = await pagamentosDe(tipo, alvo.id)
      assert.deepEqual({ ...pix.conciliadoManual, em: undefined }, { motivo: MOTIVO, porId: usuario.id, porNome: usuario.nome, em: undefined, pix: PIX_DA_MARCA }, `${papel} em ${tipo}`)
      assert.deepEqual(dinheiro, { tipo: 'dinheiro', valor: 200 })

      assert.deepEqual(await actions.desfazerConciliacaoForcadaAction(alvo, 0), { ok: true, dados: undefined }, `${papel} desfaz ${tipo}`)
      assert.deepEqual(await pagamentosDe(tipo, alvo.id), PAGAMENTOS)
    }
  }
})

test('admin_geral segue forçando e desfazendo no grupo ativo (comportamento já existia)', async () => {
  const a = await contaComAlvos()
  usuario = sessao(a, 'admin_geral', { lojaId: null, contaId: null })
  grupoAtivoNoCookie = a.grupoId
  const alvo = { tipo: 'peca' as const, id: a.alvos.peca }
  assert.equal((await actions.forcarConciliacaoAction(alvo, 0, MOTIVO, ENTROU)).ok, true)
  assert.equal((await pagamentosDe('peca', alvo.id))[0].conciliadoManual?.porId, usuario.id)
  assert.equal((await actions.desfazerConciliacaoForcadaAction(alvo, 0)).ok, true)
  assert.deepEqual(await pagamentosDe('peca', alvo.id), PAGAMENTOS)
})

test('vendedor e mecânico recebem Sem permissão em qualquer id e com qualquer motivo, e nada grava', async () => {
  const a = await contaComAlvos()
  const b = await contaComAlvos()
  for (const papel of ['vendedor', 'mecanico']) {
    usuario = sessao(a, papel)
    for (const tipo of TIPOS) {
      // Própria loja, outra Conta e inexistente: a resposta é a mesma em qualquer id.
      for (const id of [a.alvos[tipo], b.alvos[tipo], randomUUID()]) {
        const alvo = { tipo, id }
        assert.deepEqual(await actions.forcarConciliacaoAction(alvo, 0, MOTIVO, ENTROU), { ok: false, erro: 'Sem permissão' }, `${papel} força ${tipo}`)
        assert.deepEqual(await actions.forcarConciliacaoAction(alvo, 0, 'ok', ENTROU), { ok: false, erro: 'Sem permissão' }, `${papel} força ${tipo} sem motivo`)
        assert.deepEqual(await actions.desfazerConciliacaoForcadaAction(alvo, 0), { ok: false, erro: 'Sem permissão' }, `${papel} desfaz ${tipo}`)
      }
      assert.deepEqual(await pagamentosDe(tipo, a.alvos[tipo]), PAGAMENTOS)
      assert.deepEqual(await pagamentosDe(tipo, b.alvos[tipo]), PAGAMENTOS)
    }
  }
})

test('motivo curto ou que não é texto e pagamento que não concilia são recusados com a frase e nada grava', async () => {
  const a = await contaComAlvos()
  usuario = sessao(a, 'aux_adm')
  const alvo = { tipo: 'moto' as const, id: a.alvos.moto }
  assert.deepEqual(await actions.forcarConciliacaoAction(alvo, 0, ' ok ', ENTROU), { ok: false, erro: 'Informe o motivo da conciliação forçada' })
  // O navegador pode mandar qualquer coisa no lugar do texto.
  assert.deepEqual(await actions.forcarConciliacaoAction(alvo, 0, 123 as unknown as string, ENTROU), { ok: false, erro: 'Informe o motivo da conciliação forçada' })
  assert.deepEqual(await actions.forcarConciliacaoAction(alvo, 1, MOTIVO, ENTROU), { ok: false, erro: 'Esse pagamento não precisa de conciliação' })
  assert.deepEqual(await pagamentosDe('moto', alvo.id), PAGAMENTOS)
})

// Registro de outra Conta e id inexistente recebem a mesma frase: a resposta não revela que existe.
const NAO_ENCONTRADO: Record<AlvoConciliacao['tipo'], string> = {
  moto: 'Venda não encontrada', os: 'Ordem de serviço não encontrada', peca: 'Venda de peça não encontrada',
}

// Força o PIX de cada alvo da Conta A pelo aux_adm dela: o desfazer de fora tem o que apagar.
async function forcadoNaContaA() {
  const a = await contaComAlvos()
  usuario = sessao(a, 'aux_adm')
  for (const tipo of TIPOS) assert.equal((await actions.forcarConciliacaoAction({ tipo, id: a.alvos[tipo] }, 0, MOTIVO, ENTROU)).ok, true)
  return { a, comoFicou: await Promise.all(TIPOS.map(t => pagamentosDe(t, a.alvos[t]))) }
}

async function recusaComoInexistente(rotulo: string, a: Base & { alvos: Alvos }, comoFicou: PgtoOS[][]) {
  for (const tipo of TIPOS) {
    const recusa = { ok: false, erro: NAO_ENCONTRADO[tipo] }
    assert.deepEqual(await actions.forcarConciliacaoAction({ tipo, id: a.alvos[tipo] }, 0, MOTIVO, ENTROU), recusa, `${rotulo} força ${tipo}`)
    assert.deepEqual(await actions.desfazerConciliacaoForcadaAction({ tipo, id: a.alvos[tipo] }, 0), recusa, `${rotulo} desfaz ${tipo}`)
    assert.deepEqual(await actions.forcarConciliacaoAction({ tipo, id: randomUUID() }, 0, MOTIVO, ENTROU), recusa, `${rotulo} id inexistente ${tipo}`)
  }
  assert.deepEqual(await Promise.all(TIPOS.map(t => pagamentosDe(t, a.alvos[t]))), comoFicou, `${rotulo}: Conta A intacta`)
}

test('aux_adm e admin_socio da Conta B recebem a frase do inexistente no alvo da Conta A, que fica intacto', async () => {
  const { a, comoFicou } = await forcadoNaContaA()
  const b = await contaComAlvos()
  for (const papel of ['aux_adm', 'admin_socio']) {
    usuario = sessao(b, papel)
    await recusaComoInexistente(`${papel} da Conta B`, a, comoFicou)
  }
})

test('admin_geral com outro grupo ativo recebe a frase do inexistente e não grava', async () => {
  const { a, comoFicou } = await forcadoNaContaA()
  const b = await contaComAlvos()
  usuario = sessao(b, 'admin_geral', { lojaId: null, contaId: null })
  grupoAtivoNoCookie = b.grupoId
  await recusaComoInexistente('admin_geral no grupo B', a, comoFicou)
})

test('admin_rede (persona real) força no grupo liberado; em grupo não liberado recebe a frase do inexistente', async () => {
  const { usuarioDaRede } = await import('@/lib/grupos-liberados')
  const casa = await contaComAlvos()
  const liberado = await contaComAlvos()
  const { a: naoLiberado, comoFicou } = await forcadoNaContaA()
  const rede = sessaoDe(casa, 'admin_rede', randomUUID())
  const vivos = [{ grupoId: liberado.grupoId, contaId: liberado.contaId }]

  grupoAtivoNoCookie = liberado.grupoId
  usuario = usuarioDaRede(rede, vivos, grupoAtivoNoCookie)
  assert.equal((await actions.forcarConciliacaoAction({ tipo: 'os', id: liberado.alvos.os }, 0, MOTIVO, ENTROU)).ok, true)
  assert.equal((await pagamentosDe('os', liberado.alvos.os))[0].conciliadoManual?.porId, rede.id)

  grupoAtivoNoCookie = naoLiberado.grupoId
  usuario = usuarioDaRede(rede, vivos, grupoAtivoNoCookie)
  await recusaComoInexistente('admin_rede fora do liberado', naoLiberado, comoFicou)
})

test('índice de pagamento forjado é recusado e nada grava', async () => {
  const { a, comoFicou } = await forcadoNaContaA()
  usuario = sessao(a, 'aux_adm')
  const alvo = { tipo: 'peca' as const, id: a.alvos.peca }
  // O navegador manda qualquer coisa no lugar do número.
  for (const idx of ['length', '0', 1.5, -1, 99] as unknown as number[]) {
    const recusa = { ok: false, erro: 'Pagamento não encontrado' }
    assert.deepEqual(await actions.forcarConciliacaoAction(alvo, idx, MOTIVO, ENTROU), recusa, `força ${idx}`)
    assert.deepEqual(await actions.desfazerConciliacaoForcadaAction(alvo, idx), recusa, `desfaz ${idx}`)
  }
  assert.deepEqual(await pagamentosDe('peca', alvo.id), comoFicou[TIPOS.indexOf('peca')])
})

// Alcance decidido pelo Luis (P2, 18/11/2026): o grupo ativo inteiro, não só a loja de quem força.
test('aux_adm força a venda de outra loja do mesmo grupo', async () => {
  const a = await contaComAlvos()
  const outraLoja = await semearLoja(db, a.grupoId, 'FC79 outra loja ' + randomUUID())
  const peca = await semearVendaPeca(db, { ...a.balcao, lojaId: outraLoja }, PAGAMENTOS)
  usuario = sessao(a, 'aux_adm')
  assert.equal((await actions.forcarConciliacaoAction({ tipo: 'peca', id: peca }, 0, MOTIVO, ENTROU)).ok, true)
  assert.equal((await pagamentosDe('peca', peca))[0].conciliadoManual?.porId, usuario.id)
})

test('admin_socio da mesma Conta com outro grupo ativo recebe a frase do inexistente e não grava', async () => {
  const { a, comoFicou } = await forcadoNaContaA()
  const suf = randomUUID()
  const outroGrupo = await semearGrupo(db, a.contaId, { prefixo: 'FC79', nome: suf, cnpj: suf })
  usuario = sessao(a, 'admin_socio', { lojaId: null, gruposAcesso: [a.grupoId, outroGrupo.grupoId] })
  grupoAtivoNoCookie = outroGrupo.grupoId
  await recusaComoInexistente('admin_socio no outro grupo da Conta', a, comoFicou)
})

// ─── Forçar PIX com o valor que entrou na conta (#92) ──────────────────────────────────────────────

const marcaDe = async (tipo: AlvoConciliacao['tipo'], id: string, idx = 0) => (await pagamentosDe(tipo, id))[idx].conciliadoManual

test('forçar PIX grava na marca o que entrou, o valor do PIX e o custo, nos 3 alvos; desfazer tira tudo', async () => {
  const a = await contaComAlvos()
  usuario = sessao(a, 'aux_adm')
  for (const tipo of TIPOS) {
    const alvo = { tipo, id: a.alvos[tipo] }
    assert.equal((await actions.forcarConciliacaoAction(alvo, 0, MOTIVO, 997.5)).ok, true, tipo)
    assert.deepEqual((await marcaDe(tipo, alvo.id))?.pix, { valorRecebido: 997.5, valorBruto: 1000, custoPix: 2.5, custoPixTaxa: 0.0025 }, tipo)
    assert.equal((await actions.desfazerConciliacaoForcadaAction(alvo, 0)).ok, true)
    assert.deepEqual(await pagamentosDe(tipo, alvo.id), PAGAMENTOS, `${tipo}: sem marca nenhuma`)
  }
})

test('forçar PIX sem valor que se leia é recusado, e o pedido forjado não grava valor do PIX nem custo vindos da tela', async () => {
  const a = await contaComAlvos()
  usuario = sessao(a, 'aux_adm')
  const alvo = { tipo: 'moto' as const, id: a.alvos.moto }
  for (const valor of [undefined, 0, -1, '998', null, { valorRecebido: 998, valorBruto: 1, custoPix: 999 }] as unknown as number[]) {
    assert.deepEqual(await actions.forcarConciliacaoAction(alvo, 0, MOTIVO, valor), { ok: false, erro: 'Informe o valor que entrou na conta' }, JSON.stringify(valor))
  }
  assert.deepEqual(await pagamentosDe('moto', alvo.id), PAGAMENTOS, 'nada grava')
  // Argumentos a mais e alvo com campos a mais: a marca é só o que o servidor calcula.
  const forjado = { ...alvo, valorBruto: 1, custoPix: 999, grupoId: randomUUID() } as unknown as AlvoConciliacao
  const extra = actions.forcarConciliacaoAction as unknown as (...a: unknown[]) => Promise<{ ok: boolean }>
  assert.equal((await extra(forjado, 0, MOTIVO, 998, { custoPix: 999 })).ok, true)
  const marca = await marcaDe('moto', alvo.id)
  assert.deepEqual({ ...marca, em: undefined }, { motivo: MOTIVO, porId: usuario.id, porNome: usuario.nome, em: undefined, pix: PIX_DA_MARCA })
})

test('PIX já forçado não se força por cima: pede para desfazer antes, e a marca fica', async () => {
  const a = await contaComAlvos()
  usuario = sessao(a, 'aux_adm')
  const alvo = { tipo: 'os' as const, id: a.alvos.os }
  assert.equal((await actions.forcarConciliacaoAction(alvo, 0, MOTIVO, 998)).ok, true)
  const antes = await pagamentosDe('os', alvo.id)
  assert.deepEqual(await actions.forcarConciliacaoAction(alvo, 0, 'Outro motivo', 900),
    { ok: false, erro: 'Este pagamento já foi marcado como recebido. Desfaça antes de marcar de novo.' })
  assert.deepEqual(await pagamentosDe('os', alvo.id), antes)
})

// Decisão do Luis registrada na #92: PIX parcial força só o que falta.
test('PIX parcial (um PIX vinculado cobre parte): a marca guarda só o que faltava (base 600), não o pagamento inteiro', async () => {
  const a = await contaComAlvos()
  usuario = sessao(a, 'aux_adm')
  const pix = await semearPixRecebido(db, a.grupoId, { valor: 399.2 })
  await db.execute(sql`update pix_recebimentos_mcp set tipo_correspondencia = 'venda', venda_id = ${a.alvos.moto},
    valor_bruto = 400, custo_pix = 0.8, custo_pix_taxa = 0.002 where id = ${pix}`)
  assert.equal((await actions.forcarConciliacaoAction({ tipo: 'moto', id: a.alvos.moto }, 0, 'Resto caiu na conta pessoal', 598.8)).ok, true)
  assert.deepEqual((await marcaDe('moto', a.alvos.moto))?.pix, { valorRecebido: 598.8, valorBruto: 600, custoPix: 1.2, custoPixTaxa: 0.002 })
})

test('PIX parcial pela maquininha (linha pix do Mercado Pago vinculada): a marca guarda só o que faltava', async () => {
  const a = await contaComAlvos()
  usuario = sessao(a, 'aux_adm')
  await db.execute(sql`insert into conciliacoes_cartao (grupo_id, operadora, data_transacao, valor_bruto, tipo, venda_id, conciliado)
    values (${a.grupoId}, 'mercadopago', '2026-11-19', 400, 'pix', ${a.alvos.moto}, true)`)
  assert.equal((await actions.forcarConciliacaoAction({ tipo: 'moto', id: a.alvos.moto }, 0, 'Resto caiu na conta pessoal', 598.8)).ok, true)
  assert.deepEqual((await marcaDe('moto', a.alvos.moto))?.pix, { valorRecebido: 598.8, valorBruto: 600, custoPix: 1.2, custoPixTaxa: 0.002 })
})

test('forçar cartão e financiamento ignora o valor que entrou: a marca é só motivo e autor', async () => {
  const a = await semearContaComAlvos(db, 'FC79', [{ tipo: 'cartao_credito', valor: 500 }, { tipo: 'financiamento', valor: 8000 }])
  usuario = sessao(a, 'aux_adm')
  for (const idx of [0, 1]) {
    assert.equal((await actions.forcarConciliacaoAction({ tipo: 'moto', id: a.alvos.moto }, idx, MOTIVO, 123)).ok, true)
    assert.deepEqual({ ...(await marcaDe('moto', a.alvos.moto, idx)), em: undefined }, { motivo: MOTIVO, porId: usuario.id, porNome: usuario.nome, em: undefined }, String(idx))
  }
})

test('PIX vinculado que completa uma forçada parcial não se desvincula: pede para desfazer a forçada antes', async () => {
  const a = await contaComAlvos()
  usuario = sessao(a, 'aux_adm')
  const pix = await semearPixRecebido(db, a.grupoId, { valor: 399.2 })
  await db.execute(sql`update pix_recebimentos_mcp set tipo_correspondencia = 'peca', peca_venda_id = ${a.alvos.peca},
    valor_bruto = 400, custo_pix = 0.8, custo_pix_taxa = 0.002 where id = ${pix}`)
  assert.equal((await actions.forcarConciliacaoAction({ tipo: 'peca', id: a.alvos.peca }, 0, 'Resto caiu na conta pessoal', 598.8)).ok, true)
  assert.deepEqual(await actions.desvincularPixAlvoAction(pix),
    { ok: false, erro: 'Este PIX completa um pagamento marcado como recebido. Desfaça a forçada antes de desvincular.' })
  assert.equal((await execRows(sql`select peca_venda_id from pix_recebimentos_mcp where id = ${pix}`))[0].peca_venda_id, a.alvos.peca)
  // Desfeita a forçada, o PIX se desvincula.
  assert.equal((await actions.desfazerConciliacaoForcadaAction({ tipo: 'peca', id: a.alvos.peca }, 0)).ok, true)
  assert.equal((await actions.desvincularPixAlvoAction(pix)).ok, true)
})
