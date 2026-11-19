// Teste de banco: vincular e desvincular PIX a venda de moto, OS e venda de peça pela conciliação (#90),
// e as buscas do alvo, pelas Server Actions de verdade contra o Postgres descartável. Só a fronteira de
// fora é simulada: sessão, cookie do grupo ativo e revalidatePath.
import { after, afterEach, before, mock, test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { semearGrupo, semearLoja, semearUsuario, type Base } from '@/test/semear-conta'
import { semearContaComAlvos, semearPixRecebido, semearVendaMoto } from '@/test/semear-alvos-conciliacao'
import { ALVO_TIPOS, type AlvoConciliacao } from '@/lib/conciliacao-alvo'

const url = process.env.TEST_DATABASE_URL
if (!url || !['localhost', '127.0.0.1'].includes(new URL(url).hostname)) throw new Error('Use somente Postgres descartável local')
process.env.DATABASE_URL = url

type Db = typeof import('@/lib/db')
type Sessao = { id: string; nome: string; papel: string; lojaId: string | null; contaId: string | null; gruposAcesso: string[]; gruposAprovacao: string[] }
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

const PAGAMENTOS = [{ tipo: 'pix', valor: 1000 }]
const TIPOS = ALVO_TIPOS
const NAO_ENCONTRADO: Record<AlvoConciliacao['tipo'], string> = {
  moto: 'Venda não encontrada', os: 'Ordem de serviço não encontrada', peca: 'Venda de peça não encontrada',
}
const PIX_NAO_ENCONTRADO = { ok: false, erro: 'PIX não encontrado no grupo ativo' }
const COLUNA: Record<AlvoConciliacao['tipo'], string> = { moto: 'venda_id', os: 'os_id', peca: 'peca_venda_id' }

const contaComAlvos = () => semearContaComAlvos(db, 'VP90', PAGAMENTOS)

// Usuário semeado de verdade: o vincular grava quem lançou (lancado_por_id, FK de usuarios).
const sessao = async (b: Base, papel: string, extra: Partial<Sessao> = {}): Promise<Sessao> =>
  ({ id: await semearUsuario(db, b, { papel, rotulo: `${papel}-${randomUUID()}` }), nome: `${papel} de teste`, papel, lojaId: b.lojaId, contaId: b.contaId, gruposAcesso: [], gruposAprovacao: [], ...extra })

const vinculoDe = async (pixId: string) => (await execRows(sql`
  select tipo_correspondencia, venda_id, os_id, peca_venda_id, pedido_id, lancado_por_id is not null as lancado
  from pix_recebimentos_mcp where id = ${pixId}`))[0]
const LIVRE = { tipo_correspondencia: null, venda_id: null, os_id: null, peca_venda_id: null, pedido_id: null, lancado: false }

// PIX ligado ao alvo pela própria Conta: o de fora tem o que tentar mudar.
async function vinculadoNaContaA() {
  const a = await contaComAlvos()
  usuario = await sessao(a, 'aux_adm')
  const pix = await semearPixRecebido(db, a.grupoId, { valor: 1000 })
  assert.deepEqual(await actions.vincularPixAlvoAction(pix, { tipo: 'moto', id: a.alvos.moto }), { ok: true, dados: undefined })
  return { a, pix, comoFicou: await vinculoDe(pix) }
}

test('aux_adm vincula e desvincula PIX na venda de moto, na OS e na venda de peça', async () => {
  const a = await contaComAlvos()
  usuario = await sessao(a, 'aux_adm')
  for (const tipo of TIPOS) {
    const pix = await semearPixRecebido(db, a.grupoId, { valor: 1000 })
    assert.deepEqual(await actions.vincularPixAlvoAction(pix, { tipo, id: a.alvos[tipo] }), { ok: true, dados: undefined }, `vincula ${tipo}`)
    const v = await vinculoDe(pix)
    assert.equal(v.tipo_correspondencia, tipo === 'moto' ? 'venda' : tipo, tipo)
    assert.equal(v[COLUNA[tipo]], a.alvos[tipo], tipo)
    assert.deepEqual(await actions.desvincularPixAlvoAction(pix), { ok: true, dados: undefined }, `desvincula ${tipo}`)
    assert.deepEqual(await vinculoDe(pix), LIVRE, tipo)
  }
})

test('Conta B: alvo da Conta A e alvo inexistente recebem a mesma frase, e nada grava', async () => {
  const a = await contaComAlvos()
  const b = await contaComAlvos()
  usuario = await sessao(b, 'aux_adm')
  const pix = await semearPixRecebido(db, b.grupoId, { valor: 1000 })
  for (const tipo of TIPOS) {
    const recusa = { ok: false, erro: NAO_ENCONTRADO[tipo] }
    assert.deepEqual(await actions.vincularPixAlvoAction(pix, { tipo, id: a.alvos[tipo] }), recusa, `alvo da A ${tipo}`)
    assert.deepEqual(await actions.vincularPixAlvoAction(pix, { tipo, id: randomUUID() }), recusa, `inexistente ${tipo}`)
  }
  assert.deepEqual(await vinculoDe(pix), LIVRE)
})

test('Conta B: PIX da Conta A e PIX inexistente recebem a mesma frase, no vincular e no desvincular, e a A fica intacta', async () => {
  const { pix, comoFicou } = await vinculadoNaContaA()
  const b = await contaComAlvos()
  usuario = await sessao(b, 'admin_socio')
  for (const id of [pix, randomUUID(), 'nao-e-uuid']) {
    assert.deepEqual(await actions.vincularPixAlvoAction(id, { tipo: 'moto', id: b.alvos.moto }), PIX_NAO_ENCONTRADO, `vincula ${id}`)
    assert.deepEqual(await actions.desvincularPixAlvoAction(id), PIX_NAO_ENCONTRADO, `desvincula ${id}`)
  }
  assert.deepEqual(await vinculoDe(pix), comoFicou)
})

test('mesma Conta, outro grupo: PIX do grupo ativo não se liga à venda do outro grupo', async () => {
  const a = await contaComAlvos()
  const suf = randomUUID()
  const outro = await semearGrupo(db, a.contaId, { prefixo: 'VP90', nome: suf, cnpj: suf })
  const lojaOutro = await semearLoja(db, outro.grupoId, 'VP90 loja ' + suf)
  const vendaOutro = await semearVendaMoto(db, { ...a.balcao, lojaId: lojaOutro }, PAGAMENTOS)
  usuario = await sessao(a, 'admin_socio', { lojaId: null, gruposAcesso: [a.grupoId, outro.grupoId] })
  grupoAtivoNoCookie = a.grupoId
  const pix = await semearPixRecebido(db, a.grupoId, { valor: 1000 })
  assert.deepEqual(await actions.vincularPixAlvoAction(pix, { tipo: 'moto', id: vendaOutro }), { ok: false, erro: 'Venda não encontrada' })
  assert.deepEqual(await vinculoDe(pix), LIVRE)
  assert.deepEqual(await execRows(sql`select id from pix_recebimentos_mcp where venda_id = ${vendaOutro}`), [], 'venda do outro grupo sem PIX')
})

// Decisão do Luis (18/11/2026): para trocar o vínculo, desvincula antes; o custo gravado não muda calado.
test('PIX já vinculado não se vincula por cima: pede para desvincular antes, e o vínculo fica', async () => {
  const { a, pix, comoFicou } = await vinculadoNaContaA()
  for (const tipo of TIPOS) {
    assert.deepEqual(await actions.vincularPixAlvoAction(pix, { tipo, id: a.alvos[tipo] }),
      { ok: false, erro: 'Este PIX já está vinculado. Desvincule antes de vincular de novo.' }, tipo)
  }
  assert.deepEqual(await vinculoDe(pix), comoFicou)
})

test('PIX de transferência interna do próprio grupo não se vincula, e nada grava', async () => {
  const a = await contaComAlvos()
  usuario = await sessao(a, 'aux_adm')
  const interno = await semearPixRecebido(db, a.grupoId, { valor: 1000, pagadorNome: 'MOTOCHEFE LTDA' })
  assert.deepEqual(await actions.vincularPixAlvoAction(interno, { tipo: 'moto', id: a.alvos.moto }),
    { ok: false, erro: 'Essa transferência é interna (maquininha/conta do próprio grupo) e não pode ser conciliada com uma venda' })
  assert.deepEqual(await vinculoDe(interno), LIVRE)
})

test('vendedor e mecânico recebem Sem permissão no vincular e no desvincular, e nada grava', async () => {
  const { a, pix, comoFicou } = await vinculadoNaContaA()
  const livre = await semearPixRecebido(db, a.grupoId, { valor: 1000 })
  for (const papel of ['vendedor', 'mecanico']) {
    usuario = await sessao(a, papel)
    assert.deepEqual(await actions.vincularPixAlvoAction(livre, { tipo: 'os', id: a.alvos.os }), { ok: false, erro: 'Sem permissão' }, papel)
    assert.deepEqual(await actions.desvincularPixAlvoAction(pix), { ok: false, erro: 'Sem permissão' }, papel)
  }
  assert.deepEqual(await vinculoDe(pix), comoFicou)
  assert.deepEqual(await vinculoDe(livre), LIVRE)
})

test('buscas do alvo: o gestor e o vendedor da loja veem o PIX e o cartão do alvo; vendedor de outra loja recebe vazio', async () => {
  const a = await contaComAlvos()
  usuario = await sessao(a, 'aux_adm')
  const esperado: Record<string, { pix: string; cartao: string }> = {}
  for (const tipo of TIPOS) {
    const pix = await semearPixRecebido(db, a.grupoId, { valor: 1000 })
    assert.equal((await actions.vincularPixAlvoAction(pix, { tipo, id: a.alvos[tipo] })).ok, true, tipo)
    const [c] = await execRows(sql`insert into conciliacoes_cartao (grupo_id, operadora, data_transacao, valor_bruto, ${sql.raw(COLUNA[tipo])}, conciliado)
      values (${a.grupoId}, 'cielo', current_date, 1000, ${a.alvos[tipo]}, true) returning id`)
    esperado[tipo] = { pix, cartao: c.id }
  }
  const outraLoja = await semearLoja(db, a.grupoId, 'VP90 outra loja ' + randomUUID())
  const veem = [await sessao(a, 'aux_adm'), await sessao(a, 'vendedor')]
  for (const quem of veem) {
    usuario = quem
    for (const tipo of TIPOS) {
      const alvo = { tipo, id: a.alvos[tipo] }
      assert.deepEqual((await actions.buscarPixDoAlvo(alvo)).map(p => p.id), [esperado[tipo].pix], `${quem.papel} PIX ${tipo}`)
      assert.deepEqual((await actions.buscarConciliacoesDoAlvo(alvo)).map(c => c.id), [esperado[tipo].cartao], `${quem.papel} cartão ${tipo}`)
    }
  }
  usuario = await sessao(a, 'vendedor', { lojaId: outraLoja })
  for (const tipo of TIPOS) {
    assert.deepEqual(await actions.buscarPixDoAlvo({ tipo, id: a.alvos[tipo] }), [], `outra loja PIX ${tipo}`)
    assert.deepEqual(await actions.buscarConciliacoesDoAlvo({ tipo, id: a.alvos[tipo] }), [], `outra loja cartão ${tipo}`)
  }
})

test('buscas do alvo: alvo da Conta A visto pela Conta B responde como o inexistente, sem erro', async () => {
  const { a } = await vinculadoNaContaA()
  const b = await contaComAlvos()
  usuario = await sessao(b, 'aux_adm')
  for (const tipo of TIPOS) {
    for (const id of [a.alvos[tipo], randomUUID()]) {
      assert.deepEqual(await actions.buscarPixDoAlvo({ tipo, id }), [], `PIX ${tipo}`)
      assert.deepEqual(await actions.buscarConciliacoesDoAlvo({ tipo, id }), [], `cartão ${tipo}`)
    }
  }
})

test('alvo forjado (tipo fora da lista com id de venda real, ou id que não é uuid) vale como inexistente em todas as actions', async () => {
  const { a, pix, comoFicou } = await vinculadoNaContaA()
  const livre = await semearPixRecebido(db, a.grupoId, { valor: 1000 })
  const pagamentosAntes = (await execRows(sql`select pagamentos from vendas where id = ${a.alvos.moto}`))[0].pagamentos
  // Tipo fora da lista responde como venda; tipo da lista com id inválido, pela frase do tipo.
  const forjados: [unknown, string][] = [
    [{ tipo: 'xyz', id: a.alvos.moto }, 'Venda não encontrada'],
    [{ tipo: 'moto', id: 'venda-1' }, 'Venda não encontrada'],
    [{ tipo: 'os', id: 'os-1' }, 'Ordem de serviço não encontrada'],
  ]
  for (const [forjado, frase] of forjados) {
    const alvo = forjado as AlvoConciliacao
    const rotulo = JSON.stringify(alvo)
    const recusa = { ok: false, erro: frase }
    assert.deepEqual(await actions.buscarPixDoAlvo(alvo), [], `busca PIX ${rotulo}`)
    assert.deepEqual(await actions.buscarConciliacoesDoAlvo(alvo), [], `busca cartão ${rotulo}`)
    assert.deepEqual(await actions.vincularPixAlvoAction(livre, alvo), recusa, `vincula ${rotulo}`)
    assert.deepEqual(await actions.forcarConciliacaoAction(alvo, 0, 'PIX caiu na conta pessoal'), recusa, `força ${rotulo}`)
    assert.deepEqual(await actions.desfazerConciliacaoForcadaAction(alvo, 0), recusa, `desfaz ${rotulo}`)
  }
  assert.deepEqual(await vinculoDe(livre), LIVRE)
  assert.deepEqual(await vinculoDe(pix), comoFicou)
  assert.deepEqual((await execRows(sql`select pagamentos from vendas where id = ${a.alvos.moto}`))[0].pagamentos, pagamentosAntes)
})
