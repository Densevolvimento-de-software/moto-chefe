// Teste de banco: forçar e desfazer a conciliação de um pagamento (#79) pelas Server Actions de
// verdade, contra o Postgres descartável. Só a fronteira de fora é simulada: sessão, cookie do
// grupo ativo e revalidatePath. O admin_rede vem do `usuarioDaRede` real, como em produção.
import { after, afterEach, before, mock, test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { semearGrupo, semearLoja, type Base } from '@/test/semear-conta'
import { semearContaComAlvos, semearLinhaDaMaquininha, semearPixRecebido, semearVendaPeca } from '@/test/semear-alvos-conciliacao'
import { ALVO_TIPOS } from '@/lib/conciliacao-alvo'
import type { AlvoConciliacao } from './actions'
import type { PgtoOS } from '@/lib/conciliacao-status'
import { sessaoDe, type Sessao } from '@/test/sessao'
import { ate, sessaoQueSegura } from '@/test/corrida'

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
      assert.deepEqual(await actions.forcarConciliacaoAction(alvo, 0, MOTIVO, ENTROU, 1000), { ok: true, dados: undefined }, `${papel} força ${tipo}`)
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
  assert.equal((await actions.forcarConciliacaoAction(alvo, 0, MOTIVO, ENTROU, 1000)).ok, true)
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
        assert.deepEqual(await actions.forcarConciliacaoAction(alvo, 0, MOTIVO, ENTROU, 1000), { ok: false, erro: 'Sem permissão' }, `${papel} força ${tipo}`)
        assert.deepEqual(await actions.forcarConciliacaoAction(alvo, 0, 'ok', ENTROU, 1000), { ok: false, erro: 'Sem permissão' }, `${papel} força ${tipo} sem motivo`)
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
  assert.deepEqual(await actions.forcarConciliacaoAction(alvo, 0, ' ok ', ENTROU, 1000), { ok: false, erro: 'Informe o motivo da conciliação forçada' })
  // O navegador pode mandar qualquer coisa no lugar do texto.
  assert.deepEqual(await actions.forcarConciliacaoAction(alvo, 0, 123 as unknown as string, ENTROU, 1000), { ok: false, erro: 'Informe o motivo da conciliação forçada' })
  assert.deepEqual(await actions.forcarConciliacaoAction(alvo, 1, MOTIVO, ENTROU, 1000), { ok: false, erro: 'Esse pagamento não precisa de conciliação' })
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
  for (const tipo of TIPOS) assert.equal((await actions.forcarConciliacaoAction({ tipo, id: a.alvos[tipo] }, 0, MOTIVO, ENTROU, 1000)).ok, true)
  return { a, comoFicou: await Promise.all(TIPOS.map(t => pagamentosDe(t, a.alvos[t]))) }
}

async function recusaComoInexistente(rotulo: string, a: Base & { alvos: Alvos }, comoFicou: PgtoOS[][]) {
  for (const tipo of TIPOS) {
    const recusa = { ok: false, erro: NAO_ENCONTRADO[tipo] }
    assert.deepEqual(await actions.forcarConciliacaoAction({ tipo, id: a.alvos[tipo] }, 0, MOTIVO, ENTROU, 1000), recusa, `${rotulo} força ${tipo}`)
    assert.deepEqual(await actions.desfazerConciliacaoForcadaAction({ tipo, id: a.alvos[tipo] }, 0), recusa, `${rotulo} desfaz ${tipo}`)
    assert.deepEqual(await actions.forcarConciliacaoAction({ tipo, id: randomUUID() }, 0, MOTIVO, ENTROU, 1000), recusa, `${rotulo} id inexistente ${tipo}`)
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
  assert.equal((await actions.forcarConciliacaoAction({ tipo: 'os', id: liberado.alvos.os }, 0, MOTIVO, ENTROU, 1000)).ok, true)
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
    assert.deepEqual(await actions.forcarConciliacaoAction(alvo, idx, MOTIVO, ENTROU, 1000), recusa, `força ${idx}`)
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
  assert.equal((await actions.forcarConciliacaoAction({ tipo: 'peca', id: peca }, 0, MOTIVO, ENTROU, 1000)).ok, true)
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

const FORCADO_CARTAO = (u: Sessao) => ({ motivo: 'Operadora não mandou o relatório', porId: u.id, porNome: u.nome ?? '', em: '2026-11-19T12:00:00.000Z' })
const marcaDe = async (tipo: AlvoConciliacao['tipo'], id: string, idx = 0) => (await pagamentosDe(tipo, id))[idx].conciliadoManual

test('forçar PIX grava na marca o que entrou, o valor do PIX e o custo, nos 3 alvos; desfazer tira tudo', async () => {
  const a = await contaComAlvos()
  usuario = sessao(a, 'aux_adm')
  for (const tipo of TIPOS) {
    const alvo = { tipo, id: a.alvos[tipo] }
    assert.equal((await actions.forcarConciliacaoAction(alvo, 0, MOTIVO, 997.5, 1000)).ok, true, tipo)
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
    assert.deepEqual(await actions.forcarConciliacaoAction(alvo, 0, MOTIVO, valor, 1000), { ok: false, erro: 'Informe o valor que entrou na conta' }, JSON.stringify(valor))
  }
  assert.deepEqual(await pagamentosDe('moto', alvo.id), PAGAMENTOS, 'nada grava')
  // Argumentos a mais e alvo com campos a mais: a marca é só o que o servidor calcula.
  const forjado = { ...alvo, valorBruto: 1, custoPix: 999, grupoId: randomUUID() } as unknown as AlvoConciliacao
  const extra = actions.forcarConciliacaoAction as unknown as (...a: unknown[]) => Promise<{ ok: boolean }>
  assert.equal((await extra(forjado, 0, MOTIVO, 998, 1000, { custoPix: 999 })).ok, true)
  const marca = await marcaDe('moto', alvo.id)
  assert.deepEqual({ ...marca, em: undefined }, { motivo: MOTIVO, porId: usuario.id, porNome: usuario.nome, em: undefined, pix: PIX_DA_MARCA })
})

test('PIX já forçado não se força por cima: pede para desfazer antes, e a marca fica', async () => {
  const a = await contaComAlvos()
  usuario = sessao(a, 'aux_adm')
  const alvo = { tipo: 'os' as const, id: a.alvos.os }
  assert.equal((await actions.forcarConciliacaoAction(alvo, 0, MOTIVO, 998, 1000)).ok, true)
  const antes = await pagamentosDe('os', alvo.id)
  assert.deepEqual(await actions.forcarConciliacaoAction(alvo, 0, 'Outro motivo', 900, 1000),
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
  assert.equal((await actions.forcarConciliacaoAction({ tipo: 'moto', id: a.alvos.moto }, 0, 'Resto caiu na conta pessoal', 598.8, 600)).ok, true)
  assert.deepEqual((await marcaDe('moto', a.alvos.moto))?.pix, { valorRecebido: 598.8, valorBruto: 600, custoPix: 1.2, custoPixTaxa: 0.002 })
})

test('PIX parcial pela maquininha (linha pix do Mercado Pago vinculada): a marca guarda só o que faltava', async () => {
  const a = await contaComAlvos()
  usuario = sessao(a, 'aux_adm')
  await semearLinhaDaMaquininha(db, a.grupoId, { valor: 400, alvo: { tipo: 'moto', id: a.alvos.moto } })
  assert.equal((await actions.forcarConciliacaoAction({ tipo: 'moto', id: a.alvos.moto }, 0, 'Resto caiu na conta pessoal', 598.8, 600)).ok, true)
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

// Corridas no mesmo alvo (#188): conferir e soltar, forçar e desfazer, cada um esperando a trava do alvo do outro.
// Uma sessão à parte segura uma linha e o teste confere quem espera por quem, sem depender do tempo.
const COMPLETA = { ok: false, erro: 'Este PIX completa um pagamento marcado como recebido. Desfaça a forçada antes de desvincular.' }
const OK = { ok: true, dados: undefined }
const MUDARAM = { ok: false, erro: 'Os lançamentos deste pagamento mudaram. Confira e marque de novo.' }
const COLUNA_PIX: Record<AlvoConciliacao['tipo'], [string, string]> = { moto: ['venda', 'venda_id'], os: ['os', 'os_id'], peca: ['peca', 'peca_venda_id'] }
const ligar = async (a: Awaited<ReturnType<typeof contaComAlvos>>, tipo: AlvoConciliacao['tipo'], valor: number) => {
  const pix = await semearPixRecebido(db, a.grupoId, { valor })
  const [corresp, coluna] = COLUNA_PIX[tipo]
  await db.execute(sql`update pix_recebimentos_mcp set tipo_correspondencia = ${corresp}, ${sql.raw(coluna)} = ${a.alvos[tipo]}, valor_bruto = ${valor} where id = ${pix}`)
  return pix
}
const ligadosAo = async (tipo: AlvoConciliacao['tipo'], id: string) =>
  ((await execRows(sql`select count(*)::int as n from pix_recebimentos_mcp where ${sql.raw(COLUNA_PIX[tipo][1])} = ${id}`)) as { n: number }[])[0].n
const comPagamentos = (tipo: AlvoConciliacao['tipo'], id: string, pgtos: PgtoOS[]) =>
  db.execute(sql`update ${sql.raw(TABELA[tipo])} set pagamentos = ${JSON.stringify(pgtos)}::jsonb where id = ${id}`)
const marcaParcial = (base: number) => ({ motivo: 'Resto caiu na conta pessoal', porId: usuario.id, porNome: usuario.nome ?? '',
  em: '2026-11-19T12:00:00.000Z', pix: { valorRecebido: base, valorBruto: base, custoPix: 0, custoPixTaxa: 0 } })
/** Pid da sessão que espera por uma das dadas (e não é nenhuma das já conhecidas). */
const novoEsperando = async (s: Awaited<ReturnType<typeof sessaoQueSegura>>, por: number[], conhecidos: number[] = []) => {
  let pid = 0
  await ate(async () => { pid = (await s.esperandoPor(por)).find(p => !conhecidos.includes(p)) ?? 0; return pid > 0 }, `alguém esperando ${por.join(',')}`)
  return pid
}

for (const tipo of ALVO_TIPOS) {
  test(`${tipo}: dois desvincular, cada PIX bastaria para a forçada parcial: o 2º espera a trava do alvo e recusa`, async () => {
    const a = await contaComAlvos()
    usuario = sessao(a, 'aux_adm')
    const [p1, p2] = [await ligar(a, tipo, 400), await ligar(a, tipo, 400)]
    await comPagamentos(tipo, a.alvos[tipo], [{ tipo: 'pix', valor: 1000, conciliadoManual: marcaParcial(600) }])
    const s = await sessaoQueSegura(url!)
    try {
      // Segura o PIX 1: o 1º desvincular trava o alvo, confere e para ao soltar o PIX, com a trava na mão.
      await s.travar('select id from pix_recebimentos_mcp where id = $1 for update', [p1])
      const r1 = actions.desvincularPixAlvoAction(p1)
      const d1 = await novoEsperando(s, [s.pid])
      const r2 = actions.desvincularPixAlvoAction(p2)
      await novoEsperando(s, [d1])
      await s.soltar()
      assert.deepEqual(await Promise.all([r1, r2]), [OK, COMPLETA])
    } finally { await s.fim() }
    assert.equal(await ligadosAo(tipo, a.alvos[tipo]), 1)
  })

  test(`${tipo}: forçar durante o desvincular espera a trava do alvo e recusa, porque o PIX que a tela contava soltou`, async () => {
    const a = await contaComAlvos()
    usuario = sessao(a, 'aux_adm')
    const pix = await ligar(a, tipo, 400)
    const s = await sessaoQueSegura(url!)
    try {
      await s.travar('select id from pix_recebimentos_mcp where id = $1 for update', [pix])
      const solta = actions.desvincularPixAlvoAction(pix)
      const d = await novoEsperando(s, [s.pid])
      const forca = actions.forcarConciliacaoAction({ tipo, id: a.alvos[tipo] }, 0, 'Resto caiu na conta pessoal', 598.8, 600)
      await novoEsperando(s, [d])
      await s.soltar()
      assert.deepEqual(await Promise.all([solta, forca]), [OK, MUDARAM])
    } finally { await s.fim() }
    assert.equal(await ligadosAo(tipo, a.alvos[tipo]), 0)
    assert.equal(await marcaDe(tipo, a.alvos[tipo]), undefined)
  })

  test(`${tipo}: desfazer durante o forçar de outra linha espera a vez e não apaga a marca nova`, async () => {
    const a = await contaComAlvos()
    usuario = sessao(a, 'aux_adm')
    await comPagamentos(tipo, a.alvos[tipo], [{ tipo: 'pix', valor: 1000 }, { tipo: 'cartao_credito', valor: 500, conciliadoManual: FORCADO_CARTAO(usuario) }])
    const s = await sessaoQueSegura(url!)
    try {
      await s.travar(`select id from ${TABELA[tipo]} where id = $1 for update`, [a.alvos[tipo]])
      const forca = actions.forcarConciliacaoAction({ tipo, id: a.alvos[tipo] }, 0, 'PIX caiu na conta pessoal', 1000, 1000)
      const f = await novoEsperando(s, [s.pid])
      const desfaz = actions.desfazerConciliacaoForcadaAction({ tipo, id: a.alvos[tipo] }, 1)
      await novoEsperando(s, [s.pid, f], [f])
      await s.soltar()
      assert.deepEqual(await Promise.all([forca, desfaz]), [OK, OK])
    } finally { await s.fim() }
    const pgtos = await pagamentosDe(tipo, a.alvos[tipo])
    assert.deepEqual(pgtos.map(p => Boolean(p.conciliadoManual)), [true, false])
  })

  test(`${tipo}: forçar durante o desfazer de outra linha espera a vez e grava em cima do desfeito`, async () => {
    const a = await contaComAlvos()
    usuario = sessao(a, 'aux_adm')
    await comPagamentos(tipo, a.alvos[tipo], [{ tipo: 'pix', valor: 1000 }, { tipo: 'cartao_credito', valor: 500, conciliadoManual: FORCADO_CARTAO(usuario) }])
    const s = await sessaoQueSegura(url!)
    try {
      await s.travar(`select id from ${TABELA[tipo]} where id = $1 for update`, [a.alvos[tipo]])
      const desfaz = actions.desfazerConciliacaoForcadaAction({ tipo, id: a.alvos[tipo] }, 1)
      const d = await novoEsperando(s, [s.pid])
      const forca = actions.forcarConciliacaoAction({ tipo, id: a.alvos[tipo] }, 0, 'PIX caiu na conta pessoal', 1000, 1000)
      await novoEsperando(s, [s.pid, d], [d])
      await s.soltar()
      assert.deepEqual(await Promise.all([desfaz, forca]), [OK, OK])
    } finally { await s.fim() }
    const pgtos = await pagamentosDe(tipo, a.alvos[tipo])
    assert.deepEqual(pgtos.map(p => Boolean(p.conciliadoManual)), [true, false])
  })

  test(`${tipo}: dois forçar na mesma linha: o 2º espera e recusa porque já foi marcado`, async () => {
    const a = await contaComAlvos()
    usuario = sessao(a, 'aux_adm')
    const s = await sessaoQueSegura(url!)
    try {
      await s.travar(`select id from ${TABELA[tipo]} where id = $1 for update`, [a.alvos[tipo]])
      const f1 = actions.forcarConciliacaoAction({ tipo, id: a.alvos[tipo] }, 0, 'PIX caiu na conta pessoal', 1000, 1000)
      const p1 = await novoEsperando(s, [s.pid])
      const f2 = actions.forcarConciliacaoAction({ tipo, id: a.alvos[tipo] }, 0, 'PIX caiu na conta pessoal', 990, 1000)
      await novoEsperando(s, [s.pid, p1], [p1])
      await s.soltar()
      assert.deepEqual(await Promise.all([f1, f2]),
        [OK, { ok: false, erro: 'Este pagamento já foi marcado como recebido. Desfaça antes de marcar de novo.' }])
    } finally { await s.fim() }
    assert.equal((await marcaDe(tipo, a.alvos[tipo]))?.pix?.valorRecebido, 1000)
  })
}

// Decisão do Luis registrada na #92: a tela manda a base que mostrou; o pedido com a base de antes é recusado.
test('forçar PIX com a base que a tela mostrou antes de os lançamentos mudarem: recusa e nada grava', async () => {
  const a = await contaComAlvos()
  usuario = sessao(a, 'aux_adm')
  // A tela viu o PIX de 400 vinculado (base 600); ele soltou antes do confirmar.
  const pix = await ligar(a, 'moto', 400)
  await db.execute(sql`update pix_recebimentos_mcp set tipo_correspondencia = null, venda_id = null where id = ${pix}`)
  assert.deepEqual(await actions.forcarConciliacaoAction({ tipo: 'moto', id: a.alvos.moto }, 0, 'Resto caiu na conta pessoal', 598.8, 600), MUDARAM)
  // A tela viu o pagamento inteiro (base 1000); um PIX de 400 vinculou antes do confirmar.
  await ligar(a, 'moto', 400)
  assert.deepEqual(await actions.forcarConciliacaoAction({ tipo: 'moto', id: a.alvos.moto }, 0, MOTIVO, 998, 1000), MUDARAM)
  assert.equal(await marcaDe('moto', a.alvos.moto), undefined)
})

test('PIX vinculado que completa uma forçada parcial não se desvincula: pede para desfazer a forçada antes', async () => {
  const a = await contaComAlvos()
  usuario = sessao(a, 'aux_adm')
  const pix = await semearPixRecebido(db, a.grupoId, { valor: 399.2 })
  await db.execute(sql`update pix_recebimentos_mcp set tipo_correspondencia = 'peca', peca_venda_id = ${a.alvos.peca},
    valor_bruto = 400, custo_pix = 0.8, custo_pix_taxa = 0.002 where id = ${pix}`)
  assert.equal((await actions.forcarConciliacaoAction({ tipo: 'peca', id: a.alvos.peca }, 0, 'Resto caiu na conta pessoal', 598.8, 600)).ok, true)
  assert.deepEqual(await actions.desvincularPixAlvoAction(pix),
    { ok: false, erro: 'Este PIX completa um pagamento marcado como recebido. Desfaça a forçada antes de desvincular.' })
  assert.equal((await execRows(sql`select peca_venda_id from pix_recebimentos_mcp where id = ${pix}`))[0].peca_venda_id, a.alvos.peca)
  // Desfeita a forçada, o PIX se desvincula.
  assert.equal((await actions.desfazerConciliacaoForcadaAction({ tipo: 'peca', id: a.alvos.peca }, 0)).ok, true)
  assert.equal((await actions.desvincularPixAlvoAction(pix)).ok, true)
})

// ─── #166: a linha pix da maquininha que completa a forçada parcial ─────────────────────────────
const linhaLigada = async (id: string) =>
  ((await execRows(sql`select (coalesce(venda_id, os_id, peca_venda_id) is not null and conciliado) as ligada
    from conciliacoes_cartao where id = ${id}`)) as { ligada: boolean }[])[0].ligada
const maquininha = (a: Awaited<ReturnType<typeof contaComAlvos>>, tipo: AlvoConciliacao['tipo'], valor: number, linha = 'pix') =>
  semearLinhaDaMaquininha(db, a.grupoId, { valor, alvo: { tipo, id: a.alvos[tipo] }, tipo: linha })

for (const tipo of ALVO_TIPOS) {
  test(`${tipo}: desvincular a linha pix da maquininha que completa a forçada parcial recusa; desfeita a forçada, solta`, async () => {
    const a = await contaComAlvos()
    usuario = sessao(a, 'aux_adm')
    const linha = await maquininha(a, tipo, 400)
    await comPagamentos(tipo, a.alvos[tipo], [{ tipo: 'pix', valor: 1000, conciliadoManual: marcaParcial(600) }])
    assert.deepEqual(await actions.desvincularVendaAction(linha), COMPLETA)
    assert.equal(await linhaLigada(linha), true)
    assert.equal((await actions.desfazerConciliacaoForcadaAction({ tipo, id: a.alvos[tipo] }, 0)).ok, true)
    assert.deepEqual(await actions.desvincularVendaAction(linha), OK)
    assert.equal(await linhaLigada(linha), false)
  })

  test(`${tipo}: com forçada parcial, a linha pix que cobre outro pagamento e a de cartão soltam`, async () => {
    const a = await contaComAlvos()
    usuario = sessao(a, 'aux_adm')
    const [completa, outra, cartao] = [await maquininha(a, tipo, 400), await maquininha(a, tipo, 300), await maquininha(a, tipo, 500, 'credito')]
    await comPagamentos(tipo, a.alvos[tipo], [
      { tipo: 'pix', valor: 1000, conciliadoManual: marcaParcial(600) }, { tipo: 'pix', valor: 300 }, { tipo: 'cartao_credito', valor: 500 },
    ])
    assert.deepEqual(await actions.desvincularVendaAction(outra), OK)
    assert.deepEqual(await actions.desvincularVendaAction(cartao), OK)
    assert.deepEqual(await actions.desvincularVendaAction(completa), COMPLETA)
    assert.equal(await linhaLigada(completa), true)
  })

  test(`${tipo}: PIX do banco e linha pix da maquininha, cada um bastaria para a forçada parcial: o 2º desvincular espera e recusa`, async () => {
    const a = await contaComAlvos()
    usuario = sessao(a, 'aux_adm')
    const [pix, linha] = [await ligar(a, tipo, 400), await maquininha(a, tipo, 400)]
    await comPagamentos(tipo, a.alvos[tipo], [{ tipo: 'pix', valor: 1000, conciliadoManual: marcaParcial(600) }])
    const s = await sessaoQueSegura(url!)
    try {
      // Segura o PIX do banco: o 1º desvincular trava o alvo, confere e para ao soltar o PIX.
      await s.travar('select id from pix_recebimentos_mcp where id = $1 for update', [pix])
      const r1 = actions.desvincularPixAlvoAction(pix)
      const d1 = await novoEsperando(s, [s.pid])
      const r2 = actions.desvincularVendaAction(linha)
      await novoEsperando(s, [d1])
      await s.soltar()
      assert.deepEqual(await Promise.all([r1, r2]), [OK, COMPLETA])
    } finally { await s.fim() }
    assert.equal(await linhaLigada(linha), true)
  })

  test(`${tipo}: forçar durante o desvincular da linha pix da maquininha espera a trava do alvo e recusa`, async () => {
    const a = await contaComAlvos()
    usuario = sessao(a, 'aux_adm')
    const linha = await maquininha(a, tipo, 400)
    const s = await sessaoQueSegura(url!)
    try {
      // Segura a linha: o desvincular trava o alvo, confere e para ao soltar a linha, com a trava na mão.
      await s.travar('select id from conciliacoes_cartao where id = $1 for update', [linha])
      const solta = actions.desvincularVendaAction(linha)
      const d = await novoEsperando(s, [s.pid])
      const forca = actions.forcarConciliacaoAction({ tipo, id: a.alvos[tipo] }, 0, 'Resto caiu na conta pessoal', 598.8, 600)
      await novoEsperando(s, [d])
      await s.soltar()
      assert.deepEqual(await Promise.all([solta, forca]), [OK, MUDARAM])
    } finally { await s.fim() }
    assert.equal(await linhaLigada(linha), false)
    assert.equal(await marcaDe(tipo, a.alvos[tipo]), undefined)
  })
}

test('linha religada a outro alvo enquanto o desvincular confere o primeiro: não solta do alvo novo sem conferir', async () => {
  const a = await contaComAlvos()
  usuario = sessao(a, 'aux_adm')
  const linha = await maquininha(a, 'moto', 400)
  // O alvo novo (a OS) tem a forçada parcial que a linha completa.
  await comPagamentos('os', a.alvos.os, [{ tipo: 'pix', valor: 1000, conciliadoManual: marcaParcial(600) }])
  const s = await sessaoQueSegura(url!)
  try {
    // Outro vincular religa a linha à OS e ainda não confirmou: o desvincular lê a venda, confere e espera para gravar.
    await s.travar('update conciliacoes_cartao set venda_id = null, os_id = $2 where id = $1', [linha, a.alvos.os])
    const solta = actions.desvincularVendaAction(linha)
    await novoEsperando(s, [s.pid])
    await s.soltar()
    assert.equal((await solta).ok, false)
  } finally { await s.fim() }
  assert.equal(await linhaLigada(linha), true)
})

// ─── #166 (variante 2): desfazer a forçada e desvincular a linha pix da maquininha ───────────────
const NAO_ENCONTRADA = { ok: false, erro: 'Conciliação não encontrada' }

for (const tipo of ALVO_TIPOS) {
  test(`${tipo}: aux_adm desfaz só a forçada que a linha completa e desvincula; a forçada cheia de cartão fica`, async () => {
    const a = await contaComAlvos()
    usuario = sessao(a, 'aux_adm')
    const linha = await maquininha(a, tipo, 400)
    await comPagamentos(tipo, a.alvos[tipo], [
      { tipo: 'pix', valor: 1000, conciliadoManual: marcaParcial(600) }, { tipo: 'cartao_credito', valor: 500, conciliadoManual: FORCADO_CARTAO(usuario) },
    ])
    const visto = { linhas: [{ valor: 1000, marcado: 600 }], cobre: 400 }
    assert.deepEqual((await actions.forcadaDaLinhaAction(linha)), { ok: true, dados: visto })
    assert.deepEqual(await actions.desfazerForcadaEDesvincularLinhaAction(linha, visto), OK)
    assert.equal(await linhaLigada(linha), false)
    const [pix, cartao] = await pagamentosDe(tipo, a.alvos[tipo])
    assert.equal(pix.conciliadoManual, undefined)
    assert.equal(cartao.conciliadoManual?.motivo, 'Operadora não mandou o relatório')
  })
}

test('desfazer e desvincular uma linha que não completa forçada nenhuma: só desvincula, e o resumo é nulo', async () => {
  const a = await contaComAlvos()
  usuario = sessao(a, 'aux_adm')
  const linha = await maquininha(a, 'moto', 400)
  assert.deepEqual(await actions.forcadaDaLinhaAction(linha), { ok: true, dados: null })
  assert.deepEqual(await actions.desfazerForcadaEDesvincularLinhaAction(linha, null), OK)
  assert.equal(await linhaLigada(linha), false)
})

test('desfazer e desvincular: vendedor recebe Sem permissão; Conta B, estornada e id inválido a frase do inexistente; nada muda', async () => {
  const a = await contaComAlvos()
  const b = await contaComAlvos()
  const linha = await maquininha(a, 'moto', 400)
  usuario = sessao(a, 'aux_adm')
  await comPagamentos('moto', a.alvos.moto, [{ tipo: 'pix', valor: 1000, conciliadoManual: marcaParcial(600) }])
  usuario = sessao(a, 'vendedor')
  assert.deepEqual(await actions.desfazerForcadaEDesvincularLinhaAction(linha), { ok: false, erro: 'Sem permissão' })
  assert.deepEqual(await actions.forcadaDaLinhaAction(linha), { ok: false, erro: 'Sem permissão' })
  usuario = sessao(b, 'aux_adm')
  assert.deepEqual(await actions.desfazerForcadaEDesvincularLinhaAction(linha), NAO_ENCONTRADA)
  assert.deepEqual(await actions.forcadaDaLinhaAction(linha), { ok: true, dados: null })
  assert.deepEqual(await actions.desfazerForcadaEDesvincularLinhaAction('abc'), NAO_ENCONTRADA)
  usuario = sessao(a, 'aux_adm')
  const estornada = await maquininha(a, 'moto', 300)
  await db.execute(sql`update conciliacoes_cartao set status = 'estornado', conciliado = false where id = ${estornada}`)
  assert.deepEqual(await actions.desfazerForcadaEDesvincularLinhaAction(estornada), NAO_ENCONTRADA)
  assert.equal(await linhaLigada(linha), true)
  assert.ok((await marcaDe('moto', a.alvos.moto))?.pix)
})

test('desfazer e desvincular com o resumo que a tela viu diferente do de agora: recusa e nada muda', async () => {
  const a = await contaComAlvos()
  usuario = sessao(a, 'aux_adm')
  const linha = await maquininha(a, 'os', 400)
  await comPagamentos('os', a.alvos.os, [{ tipo: 'pix', valor: 1000, conciliadoManual: marcaParcial(600) }])
  const MUDOU = { ok: false, erro: 'Os lançamentos deste pagamento mudaram. Confira e tente de novo.' }
  // A tela viu outra marca (500), ou nenhuma forçada; e o pedido forjado sem resumo.
  assert.deepEqual(await actions.desfazerForcadaEDesvincularLinhaAction(linha, { linhas: [{ valor: 1000, marcado: 500 }], cobre: 400 }), MUDOU)
  assert.deepEqual(await actions.desfazerForcadaEDesvincularLinhaAction(linha, null), MUDOU)
  assert.deepEqual(await actions.desfazerForcadaEDesvincularLinhaAction(linha), MUDOU)
  assert.equal(await linhaLigada(linha), true)
  assert.ok((await marcaDe('os', a.alvos.os))?.pix)
})

test('Conta B mandando o resumo que a Conta A viu: a frase do inexistente, não "mudaram", e nada muda', async () => {
  const a = await contaComAlvos()
  const b = await contaComAlvos()
  const linha = await maquininha(a, 'peca', 400)
  usuario = sessao(a, 'aux_adm')
  await comPagamentos('peca', a.alvos.peca, [{ tipo: 'pix', valor: 1000, conciliadoManual: marcaParcial(600) }])
  const visto = (await actions.forcadaDaLinhaAction(linha) as { dados: unknown }).dados
  usuario = sessao(b, 'aux_adm')
  assert.deepEqual(await actions.desfazerForcadaEDesvincularLinhaAction(linha, visto), NAO_ENCONTRADA)
  assert.equal(await linhaLigada(linha), true)
  assert.ok((await marcaDe('peca', a.alvos.peca))?.pix)
})

test('linha estornada enquanto o desvincular conferia: não solta a estornada (ela mantém a venda)', async () => {
  const a = await contaComAlvos()
  usuario = sessao(a, 'aux_adm')
  const linha = await maquininha(a, 'moto', 400)
  const s = await sessaoQueSegura(url!)
  try {
    // O importador marca o estorno e ainda não confirmou: o desvincular lê a linha viva, confere e espera para gravar.
    await s.travar(`update conciliacoes_cartao set status = 'estornado', conciliado = false where id = $1`, [linha])
    const solta = actions.desvincularVendaAction(linha)
    await novoEsperando(s, [s.pid])
    await s.soltar()
    assert.deepEqual(await solta, NAO_ENCONTRADA)
  } finally { await s.fim() }
  const [l] = await execRows(sql`select venda_id, status from conciliacoes_cartao where id = ${linha}`) as { venda_id: string; status: string }[]
  assert.deepEqual([l.venda_id, l.status], [a.alvos.moto, 'estornado'])
})
