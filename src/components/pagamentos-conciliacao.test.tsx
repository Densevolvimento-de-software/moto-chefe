// Painel de pagamentos da conciliação (#79): quem vê o Forçar, o que forçar e desfazer enviam e o que
// a tela mostra quando a action recusa ou falha. As actions e o toast são a fronteira de fora; o resto roda de verdade.
import test, { after, afterEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import { montarDom } from '@/test/montar-dom'
import { digitar, digitarTexto } from '@/test/eventos-dom'
import { botao, clicar, esperar, montarDialogo } from '@/test/dialogo-em-tela'
import type { AlvoConciliacao, PixLivre } from '@/app/(dashboard)/conciliacao/actions'
import type { PgtoOS } from '@/lib/conciliacao-status'
import type { ResultadoAction } from '@/lib/resultado-action'

const { desmontar: desmontarDom } = montarDom()
after(desmontarDom)

const forcar = mock.fn(async (_alvo: AlvoConciliacao, _idx: number, _motivo: string, _valorRecebido?: number): Promise<ResultadoAction> => ({ ok: true, dados: undefined }))
const desfazer = mock.fn(async (_alvo: AlvoConciliacao, _idx: number): Promise<ResultadoAction> => ({ ok: true, dados: undefined }))
type Actions = typeof import('@/app/(dashboard)/conciliacao/actions')
type ParaOAlvo = Awaited<ReturnType<Actions['buscarPixParaOAlvo']>>
type PixRec = Awaited<ReturnType<Actions['buscarPixDoAlvo']>>[number]
const buscarPixLivres = mock.fn(async (_query: string): Promise<PixLivre[]> => [])
const paraOAlvo = mock.fn(async (_alvo: AlvoConciliacao, _valor: number): Promise<ParaOAlvo> => ({ esperado: null, taxa: 0, noGrupoAtivo: true, pix: [] }))
const vincularPix = mock.fn(async (_pixId: string, _alvo: AlvoConciliacao): Promise<ResultadoAction> => ({ ok: true, dados: undefined }))
const buscarConciliacoesPorValor = mock.fn(async (): Promise<unknown[]> => [])
const vincularCartao = mock.fn(async (_id: string, _alvo: AlvoConciliacao): Promise<ResultadoAction> => ({ ok: true, dados: undefined }))
const actionsMock = mock.module('@/app/(dashboard)/conciliacao/actions', { namedExports: {
  forcarConciliacaoAction: (a: AlvoConciliacao, i: number, m: string, v?: number) => forcar(a, i, m, v),
  desfazerConciliacaoForcadaAction: (a: AlvoConciliacao, i: number) => desfazer(a, i),
  buscarPixLivres: (q: string) => buscarPixLivres(q),
  buscarConciliacoesPorValor: () => buscarConciliacoesPorValor(),
  buscarConciliacoesDoAlvo: async () => [],
  buscarPixDoAlvo: async () => [],
  buscarConciliacoesLivres: async () => [],
  vincularVendaAction: (c: string, a: AlvoConciliacao) => vincularCartao(c, a),
  vincularPixAlvoAction: (p: string, a: AlvoConciliacao) => vincularPix(p, a),
  buscarPixParaOAlvo: (a: AlvoConciliacao, v: number) => paraOAlvo(a, v),
} })
type AcaoDoToast = { action?: { label: string; onClick: () => void } }
const erros: string[] = []
const sucessos: { mensagem: string; opcoes?: AcaoDoToast }[] = []
const sonnerMock = mock.module('sonner', { namedExports: { toast: {
  error: (m: string) => { erros.push(m) },
  success: (mensagem: string, opcoes?: AcaoDoToast) => { sucessos.push({ mensagem, opcoes }) },
} } })
after(() => { actionsMock.restore(); sonnerMock.restore() })

const desmontagens: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const f of [forcar, desfazer, buscarPixLivres, buscarConciliacoesPorValor, vincularPix, paraOAlvo, vincularCartao]) f.mock.resetCalls()
  paraOAlvo.mock.restore()
  buscarConciliacoesPorValor.mock.restore()
  vincularCartao.mock.restore()
  forcar.mock.restore()
  desfazer.mock.restore()
  buscarPixLivres.mock.restore()
  vincularPix.mock.restore()
  erros.length = 0
  sucessos.length = 0
  for (const desmontar of desmontagens.splice(0)) await desmontar()
})

const ALVO: AlvoConciliacao = { tipo: 'moto', id: 'venda-1' }
const FORCADO = { motivo: 'PIX na conta pessoal', porId: 'u1', porNome: 'Aux da loja', em: '2026-11-18T12:00:00.000Z' }
// Falha interna (rede, banco): a mensagem crua não pode ir para a tela.
const FALHA_INTERNA = new Error('connect ECONNREFUSED 10.0.0.1:5432')

// Botões das linhas de pagamento, na ordem da tela; o texto de cada um começa pelo tipo.
const linhas = () => [...document.querySelectorAll<HTMLButtonElement>('button[aria-expanded], li > button[disabled]')]
const linha = (tipo: string) => linhas().find(b => (b.textContent ?? '').startsWith(tipo))

async function montar(papel: string, pagamentos: PgtoOS[], pixRecs: PixRec[] = []) {
  const { PagamentosConciliacao } = await import('./pagamentos-conciliacao')
  const dados = { concs: [], pixRecs, loading: false, recarregar: async () => {} }
  const tela = await montarDialogo(PagamentosConciliacao, { alvo: ALVO, pagamentos, dados, papel })
  desmontagens.push(tela.desmontar)
  const tocar = (el: Element | undefined) => tela.act(async () => { clicar(el); await esperar(50) })
  const escreverMotivo = async (texto: string) => {
    await digitarTexto(document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Motivo"]')!, texto)
    await tela.act(() => esperar(20))
  }
  return { ...tela, tocar, escreverMotivo }
}

test('aux_adm abre o PIX pendente, força com o motivo e o Desfazer do aviso envia o mesmo pagamento', async () => {
  const { tocar, clique, escreverMotivo, act } = await montar('aux_adm', [{ tipo: 'dinheiro', valor: 200 }, { tipo: 'pix', valor: 1000 }])
  // O PIX pendente vem antes do dinheiro na tela, mas o índice enviado é o do array (1).
  assert.deepEqual(linhas().map(b => (b.textContent ?? '').slice(0, 8)), ['PIXPende', 'Dinheiro'])
  await tocar(linha('PIX'))
  await clique('Forçar')
  await escreverMotivo('PIX na conta pessoal')
  await clique('Marcar como recebido')

  // Grupo sem custo do PIX: o valor que entrou vem preenchido com o do pagamento.
  assert.deepEqual(forcar.mock.calls.map(c => c.arguments), [[ALVO, 1, 'PIX na conta pessoal', 1000]])
  assert.equal(sucessos[0]?.mensagem, 'Pagamento marcado como recebido')
  await act(async () => { sucessos[0].opcoes!.action!.onClick(); await esperar(50) })
  assert.deepEqual(desfazer.mock.calls.map(c => c.arguments), [[ALVO, 1]])
})

test('aux_adm abre o financiamento pendente direto no Forçar, sem procurar lançamento', async () => {
  const { tocar } = await montar('aux_adm', [{ tipo: 'financiamento', valor: 8000 }])
  await tocar(linha('Financiamento'))
  assert.ok(botao('Forçar'))
  assert.equal(paraOAlvo.mock.callCount() + buscarConciliacoesPorValor.mock.callCount(), 0)
})

test('recusa do forçar aparece no aviso e o formulário fica aberto com o motivo', async () => {
  forcar.mock.mockImplementation(async () => ({ ok: false, erro: 'Venda não encontrada' }))
  const { tocar, clique, escreverMotivo } = await montar('admin_socio', [{ tipo: 'pix', valor: 1000 }])
  await tocar(linha('PIX'))
  await clique('Forçar')
  await escreverMotivo('PIX na conta pessoal')
  await clique('Marcar como recebido')

  assert.deepEqual(erros, ['Venda não encontrada'])
  assert.equal(sucessos.length, 0)
  assert.equal(document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Motivo"]')?.value, 'PIX na conta pessoal')
})

test('falha interna do forçar mostra a frase genérica, sem a mensagem do erro', async () => {
  forcar.mock.mockImplementation(async () => { throw FALHA_INTERNA })
  const { tocar, clique, escreverMotivo } = await montar('aux_adm', [{ tipo: 'pix', valor: 1000 }])
  await tocar(linha('PIX'))
  await clique('Forçar')
  await escreverMotivo('PIX na conta pessoal')
  await clique('Marcar como recebido')
  assert.deepEqual(erros, ['Erro ao forçar conciliação'])
})

test('Desfazer forçado aparece para o aux_adm e envia o índice do array', async () => {
  const { clique } = await montar('aux_adm', [{ tipo: 'dinheiro', valor: 200 }, { tipo: 'pix', valor: 1000, conciliadoManual: FORCADO }])
  await clique('Desfazer forçado')
  assert.deepEqual(desfazer.mock.calls.map(c => c.arguments), [[ALVO, 1]])
  assert.deepEqual(sucessos.map(s => s.mensagem), ['Conciliação forçada desfeita'])
})

test('recusa do desfazer aparece no aviso; falha interna mostra a frase genérica', async () => {
  const { clique } = await montar('aux_adm', [{ tipo: 'pix', valor: 1000, conciliadoManual: FORCADO }])
  desfazer.mock.mockImplementation(async () => ({ ok: false, erro: 'Venda não encontrada' }))
  await clique('Desfazer forçado')
  desfazer.mock.mockImplementation(async () => { throw FALHA_INTERNA })
  await clique('Desfazer forçado')
  assert.deepEqual(erros, ['Venda não encontrada', 'Erro ao desfazer'])
  assert.equal(sucessos.length, 0)
})

test('vendedor não abre a linha pendente nem vê o Desfazer forçado', async () => {
  await montar('vendedor', [{ tipo: 'pix', valor: 1000 }, { tipo: 'cartao_credito', valor: 500, conciliadoManual: FORCADO }])
  assert.equal(linha('PIX')?.disabled, true)
  assert.equal(botao('Desfazer forçado'), undefined)
  assert.equal(botao('Forçar')?.textContent ?? null, null)
})

const PIX_LIVRE: PixLivre = { id: 'pix-1', data: new Date('2026-11-12T14:32:00Z'), valor: '1000.00', pagadorNome: 'Pagador Exemplo', descricao: null }

test('vincular o PIX sugerido envia o PIX e o alvo; a recusa aparece com a frase da action', async () => {
  paraOAlvo.mock.mockImplementation(async () => ({ esperado: null, taxa: 0, noGrupoAtivo: true, pix: [PIX_LIVRE] }))
  const { tocar } = await montar('aux_adm', [{ tipo: 'pix', valor: 1000 }])
  await tocar(linha('PIX'))
  const vincular = () => tocar(document.querySelector('button[aria-label^="Vincular PIX de Pagador Exemplo"]') ?? undefined)

  vincularPix.mock.mockImplementation(async () => ({ ok: false, erro: 'Este PIX já está vinculado. Desvincule antes de vincular de novo.' }))
  await vincular()
  assert.deepEqual(erros, ['Este PIX já está vinculado. Desvincule antes de vincular de novo.'])
  assert.equal(sucessos.length, 0)

  vincularPix.mock.mockImplementation(async () => ({ ok: true, dados: undefined }))
  await vincular()
  assert.deepEqual(vincularPix.mock.calls.map(c => c.arguments), [['pix-1', ALVO], ['pix-1', ALVO]])
  assert.deepEqual(sucessos.map(s => s.mensagem), ['PIX conciliado'])
})

// ─── Custo do PIX na tela (#90, variante B) ──────────────────────────────────────────────────────────
const tela = () => (document.body.textContent ?? '').replace(/\s+/g, ' ')
const contaDoPix = () => [...document.querySelectorAll('dl > div')].map(d => [d.querySelector('dt')?.textContent, (d.querySelector('dd')?.textContent ?? '').replace(/\s/g, ' ')])
const pixRec = (o: Partial<PixRec>): PixRec => ({ id: 'p1', dataPagamento: new Date('2026-11-12T14:32:00Z'), valor: '9980.00', pagadorNome: 'Pagador Exemplo',
  observacao: null, valorBruto: '10000.00', custoPix: '20.00', custoPixTaxa: '0.002000', ...o })

test('PIX pendente no grupo com custo: procura perto do valor sem o custo e diz por quê', async () => {
  paraOAlvo.mock.mockImplementation(async () => ({ esperado: 9980, taxa: 0.002, noGrupoAtivo: true, pix: [{ ...PIX_LIVRE, valor: '9980.00' }] }))
  const { tocar } = await montar('aux_adm', [{ tipo: 'pix', valor: 10000 }])
  await tocar(linha('PIX'))
  assert.deepEqual(paraOAlvo.mock.calls.map(c => c.arguments), [[ALVO, 10000]])
  assert.ok(tela().includes('O banco deposita sem o custo do PIX. Procurando perto de R$ 9.980,00.'), tela())
  assert.ok(document.querySelector('button[aria-label^="Vincular PIX de Pagador Exemplo"]'))
})

test('PIX pendente no grupo sem custo: o texto de hoje, pelo valor do pagamento', async () => {
  paraOAlvo.mock.mockImplementation(async () => ({ esperado: null, taxa: 0, noGrupoAtivo: true, pix: [PIX_LIVRE] }))
  const { tocar } = await montar('aux_adm', [{ tipo: 'pix', valor: 1000 }])
  await tocar(linha('PIX'))
  assert.ok(tela().includes('PIX de valor próximo a R$ 1.000,00 ainda sem vínculo:'), tela())
  assert.equal(tela().includes('custo do PIX'), false)
})

test('PIX de venda de outro grupo: pede para trocar o grupo ativo e não procura nem oferece Vincular nem Forçar', async () => {
  paraOAlvo.mock.mockImplementation(async () => ({ esperado: 9980, taxa: 0.002, noGrupoAtivo: false, pix: [] }))
  const { tocar } = await montar('aux_adm', [{ tipo: 'pix', valor: 10000 }])
  await tocar(linha('PIX'))
  assert.ok(tela().includes('Este pagamento é de outro grupo. Troque o grupo ativo para procurar e vincular o PIX.'), tela())
  assert.equal(document.querySelector('button[aria-label^="Vincular PIX"]'), null)
  // O servidor também recusa forçar fora do grupo ativo (alvoParaEdicao): a tela não oferece.
  assert.equal(botao('Forçar')?.textContent ?? null, null)
})

test('PIX conciliado com custo: pagador e as três colunas, Valor do PIX, Custo e Entrou', async () => {
  await montar('aux_adm', [{ tipo: 'pix', valor: 10000 }], [pixRec({})])
  assert.ok(tela().includes('Conciliado · Pagador Exemplo'), tela())
  assert.deepEqual(contaDoPix(), [['Valor do PIX', 'R$ 10.000,00'], ['Custo (0,20%)', 'R$ 20,00'], ['Entrou', 'R$ 9.980,00']])
})

test('PIX conciliado sem custo gravado (TED, grupo sem custo ou vínculo antigo): mostra quem pagou, sem as colunas', async () => {
  for (const rec of [pixRec({ valorBruto: '9980.00', custoPix: '0.00', custoPixTaxa: '0.000000' }), pixRec({ valor: '10000.00', valorBruto: null, custoPix: null, custoPixTaxa: null })]) {
    const { desmontar } = await montar('aux_adm', [{ tipo: 'pix', valor: rec.valorBruto ? 9980 : 10000 }], [rec])
    assert.ok(tela().includes('Conciliado · Pagador Exemplo'), tela())
    assert.deepEqual(contaDoPix(), [], JSON.stringify(rec))
    await desmontar()
  }
})

// Decisão do Luis (19/11/2026): na linha parcial é "Coberto" (pelo valor do PIX); "Entrou" fica para o crédito, nas três colunas.
test('linha parcial diz quanto foi coberto e quanto falta', async () => {
  await montar('aux_adm', [{ tipo: 'pix', valor: 10000 }], [pixRec({ valor: '4990.00', valorBruto: '5000.00', custoPix: '10.00' })])
  assert.ok(tela().includes('Parcial · Coberto R$ 5.000,00 · faltam R$ 5.000,00'), tela())
  assert.equal(tela().includes('Parcial · Entrou'), false)
})

const CARTAO_LIVRE = { id: 'conc-1', operadora: 'mercadopago', autorizacao: '123456', valorBruto: '1000.00', dataTransacao: '2026-11-12', tipo: 'credito', rawData: null }

test('vincular a linha de cartão sugerida envia a linha e o alvo; a recusa aparece com a frase da action (#129)', async () => {
  buscarConciliacoesPorValor.mock.mockImplementation(async () => [CARTAO_LIVRE])
  const { tocar } = await montar('aux_adm', [{ tipo: 'cartao_credito', valor: 1000, parcelas: 1 }])
  await tocar(linhas()[0])
  const vincular = () => tocar(document.querySelector('button[aria-label^="Vincular "]') ?? undefined)

  vincularCartao.mock.mockImplementation(async () => ({ ok: false, erro: 'Venda não encontrada' }))
  await vincular()
  assert.deepEqual(erros, ['Venda não encontrada'])
  assert.equal(sucessos.length, 0)

  vincularCartao.mock.mockImplementation(async () => ({ ok: true, dados: undefined }))
  await vincular()
  assert.deepEqual(vincularCartao.mock.calls.map(c => c.arguments), [['conc-1', ALVO], ['conc-1', ALVO]])
  assert.deepEqual(sucessos.map(s => s.mensagem), ['Pagamento conciliado'])
  assert.ok(document.querySelector('button[aria-label^="Vincular "]') === null, 'o sucesso fecha a busca')
})

// ─── Forçar PIX com o valor que entrou na conta (#92, variante B) ───────────────────────────────────
const campoRecebido = () => document.querySelector<HTMLInputElement>('input[aria-label="Valor que entrou na conta"]')
const COM_CUSTO: ParaOAlvo = { esperado: 9980, taxa: 0.002, noGrupoAtivo: true, pix: [] }
async function abrirForcarPix(pagamentos: PgtoOS[], pixRecs: PixRec[] = []) {
  paraOAlvo.mock.mockImplementation(async () => COM_CUSTO)
  const t = await montar('aux_adm', pagamentos, pixRecs)
  await t.tocar(linha('PIX'))
  await t.clique('Forçar')
  return t
}
const digitarRecebido = async (t: Awaited<ReturnType<typeof montar>>, texto: string) => {
  await t.act(async () => { digitar(campoRecebido()!, texto) })
  await t.act(() => esperar(20))
}

test('forçar PIX: o valor que entrou vem preenchido com o esperado e as três colunas mostram a conta', async () => {
  const t = await abrirForcarPix([{ tipo: 'pix', valor: 10000 }])
  assert.equal(campoRecebido()?.value, '9.980,00')
  assert.deepEqual(contaDoPix(), [['Valor do PIX', 'R$ 10.000,00'], ['Custo (0,20%)', 'R$ 20,00'], ['Entrou', 'R$ 9.980,00']])
  await t.escreverMotivo('PIX caiu na conta pessoal')
  await t.clique('Marcar como recebido')
  assert.deepEqual(forcar.mock.calls.map(c => c.arguments), [[ALVO, 0, 'PIX caiu na conta pessoal', 9980]])
})

test('forçar PIX: valor editado recalcula as colunas e é o que se envia', async () => {
  const t = await abrirForcarPix([{ tipo: 'pix', valor: 10000 }])
  await digitarRecebido(t, '9.970,02')
  assert.deepEqual(contaDoPix(), [['Valor do PIX', 'R$ 10.000,00'], ['Custo (0,2998%)', 'R$ 29,98'], ['Entrou', 'R$ 9.970,02']])
  await t.escreverMotivo('PIX caiu na conta pessoal')
  await t.clique('Marcar como recebido')
  assert.deepEqual(forcar.mock.calls.map(c => c.arguments[3]), [9970.02])
})

test('forçar PIX: valor que não se lê avisa com a frase e não deixa confirmar', async () => {
  const t = await abrirForcarPix([{ tipo: 'pix', valor: 10000 }])
  await digitarRecebido(t, 'abc')
  await t.escreverMotivo('PIX caiu na conta pessoal')
  assert.ok(tela().includes('Informe o valor que entrou na conta'), tela())
  assert.deepEqual(contaDoPix(), [])
  assert.equal(botao('Marcar como recebido')?.disabled, true)
})

test('forçar PIX: entrou mais que o pagamento, custo 0 e aviso', async () => {
  const t = await abrirForcarPix([{ tipo: 'pix', valor: 10000 }])
  await digitarRecebido(t, '10.050,00')
  assert.deepEqual(contaDoPix(), [['Valor do PIX', 'R$ 10.000,00'], ['Custo (0,00%)', 'R$ 0,00'], ['Entrou', 'R$ 10.050,00']])
  assert.ok(tela().includes('Entrou mais que o pagamento: fica sem custo do PIX.'), tela())
})

test('forçar PIX parcial: parte do que falta, e o campo vem com o esperado dessa parte', async () => {
  await abrirForcarPix([{ tipo: 'pix', valor: 1000 }], [pixRec({ valor: '399.20', valorBruto: '400.00', custoPix: '0.80' })])
  assert.equal(campoRecebido()?.value, '598,80')
  assert.deepEqual(contaDoPix(), [['Valor do PIX', 'R$ 600,00'], ['Custo (0,20%)', 'R$ 1,20'], ['Entrou', 'R$ 598,80']])
})

test('forçar cartão: sem o campo do valor que entrou, e nada de valor na action', async () => {
  const t = await montar('aux_adm', [{ tipo: 'cartao_credito', valor: 500 }])
  await t.tocar(linha('Cartão'))
  await t.clique('Forçar')
  assert.equal(campoRecebido()?.outerHTML ?? null, null)
  await t.escreverMotivo('Operadora não mandou o relatório')
  await t.clique('Marcar como recebido')
  assert.deepEqual(forcar.mock.calls.map(c => c.arguments), [[ALVO, 0, 'Operadora não mandou o relatório', undefined]])
})

test('forçar PIX fica desabilitado até a busca do PIX trazer o esperado', async () => {
  let liberar: (v: ParaOAlvo) => void = () => {}
  paraOAlvo.mock.mockImplementation(() => new Promise<ParaOAlvo>(r => { liberar = r }))
  const t = await montar('aux_adm', [{ tipo: 'pix', valor: 10000 }])
  await t.tocar(linha('PIX'))
  assert.equal(botao('Forçar')?.disabled, true)
  await t.act(async () => { liberar(COM_CUSTO); await esperar(20) })
  assert.equal(botao('Forçar')?.disabled, false)
})

test('enquanto envia, o campo, o motivo e os botões ficam travados', async () => {
  let responder: (r: ResultadoAction) => void = () => {}
  forcar.mock.mockImplementation(() => new Promise<ResultadoAction>(r => { responder = r }))
  const t = await abrirForcarPix([{ tipo: 'pix', valor: 10000 }])
  await t.escreverMotivo('PIX caiu na conta pessoal')
  await t.clique('Marcar como recebido')
  assert.deepEqual([campoRecebido()?.disabled, document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Motivo"]')?.disabled, botao('Cancelar')?.disabled],
    [true, true, true])
  await t.act(async () => { responder({ ok: true, dados: undefined }); await esperar(20) })
})

test('Enter no motivo só envia quando o valor que entrou se lê', async () => {
  const t = await abrirForcarPix([{ tipo: 'pix', valor: 10000 }])
  const enter = () => t.act(async () => {
    document.querySelector('textarea[aria-label="Motivo"]')!.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await esperar(30)
  })
  await digitarRecebido(t, 'abc')
  await t.escreverMotivo('PIX caiu na conta pessoal')
  await enter()
  assert.equal(forcar.mock.callCount(), 0)
  await digitarRecebido(t, '9.980,00')
  await enter()
  assert.deepEqual(forcar.mock.calls.map(c => c.arguments[3]), [9980])
})
