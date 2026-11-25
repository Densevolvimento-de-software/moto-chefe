// Teste de banco: credencial do Mercado Pago no Editar Grupo (#51, PR5) e recusas que voltam como valor
// (#404). Fronteira simulada: sessão, next/cache e a rede do Mercado Pago (fetch do /users/me); grupo,
// credencial cifrada e transação rodam no Postgres descartável. Conta já ligada a outro grupo: mesma frase e
// nada grava (barrada pela consulta antes do insert; a corrida que cai no índice único não é reproduzida aqui).
import { after, before, beforeEach, mock, test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { semearContaBase, semearUsuario, type Base } from '@/test/semear-conta'

const url = process.env.TEST_DATABASE_URL
if (!url || !['localhost', '127.0.0.1'].includes(new URL(url).hostname)) throw new Error('Use somente Postgres descartável local')
process.env.DATABASE_URL = url
process.env.CERT_MASTER_KEY ??= 'c'.repeat(64)
// A conta da mensalidade vem do shell se estiver exportada; os cenários aqui não dependem dela.
delete process.env.MP_ACCESS_TOKEN

// mcp.ai falso (fronteira de fora): responde por chave (a URL carrega o segredo) e anota quais chaves foram usadas.
const MCP_FALSO = 'https://api.mcp.ai/'
const chavesUsadas: string[] = []
let mcpFalha = false
const contasDaChave = new Map<string, { bank: unknown[]; credit: unknown[] }>()
const sse = (corpo: unknown, sessao?: string) => new Response(`event: message\ndata: ${JSON.stringify(corpo)}\n\n`, { headers: sessao ? { 'mcp-session-id': sessao } : {} })
function mcpFalso(chave: string, init?: RequestInit): Response {
  chavesUsadas.push(chave)
  const corpo = JSON.parse(String(init?.body ?? '{}')) as { id: number; method: string; params?: { arguments?: { type?: string } } }
  if (mcpFalha) return sse({ jsonrpc: '2.0', id: corpo.id, error: { message: `recusou ${chave}` } })
  if (corpo.method === 'initialize') return sse({ jsonrpc: '2.0', id: corpo.id, result: {} }, 's1')
  const contas = contasDaChave.get(chave) ?? { bank: [], credit: [] }
  const results = corpo.params?.arguments?.type === 'CREDIT' ? contas.credit : contas.bank
  return sse({ jsonrpc: '2.0', id: corpo.id, result: { content: [{ text: JSON.stringify({ results }) }] } })
}

let sessao: Record<string, unknown> = {}
const mocks = [
  mock.module('@/lib/auth', { namedExports: { getUsuarioLogado: async () => sessao } }),
  mock.module('next/cache', { namedExports: { revalidatePath: () => {} } }),
]

// /users/me: cada token responde a sua conta; token desconhecido = 401.
const contasNoMp = new Map<string, { id: number; nickname: string; tags: string[]; identification?: { type: string; number: string } }>()
let chamadasMp = 0
const fetchOriginal = globalThis.fetch
before(() => {
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    if (String(_url).startsWith(MCP_FALSO)) return mcpFalso(String(_url), init)
    chamadasMp++
    const token = String((init?.headers as Record<string, string>).Authorization).replace('Bearer ', '')
    const conta = contasNoMp.get(token)
    return { ok: !!conta, status: conta ? 200 : 401, json: async () => conta ?? { message: 'unauthorized' } } as Response
  }) as typeof fetch
})

let db: typeof import('@/lib/db')['db']
let execRows: typeof import('@/lib/db')['execRows']
let acoes: typeof import('./actions')
let FRASES_MP: typeof import('@/lib/mercadopago/frases')['FRASES_MP']
before(async () => {
  ;({ db, execRows } = await import('@/lib/db'))
  acoes = await import('./actions')
  ;({ FRASES_MP } = await import('@/lib/mercadopago/frases'))
})
after(async () => {
  globalThis.fetch = fetchOriginal
  for (const m of mocks) m.restore()
  await (globalThis as { __pgPool?: { end(): Promise<void> } }).__pgPool?.end()
})
beforeEach(() => { chamadasMp = 0; chavesUsadas.length = 0; mcpFalha = false })

/** Token novo no MP, de uma conta nova (id único: os arquivos do test:db rodam em paralelo). */
function tokenDeConta(o: { tags?: string[]; documento?: string } = {}) {
  const token = `APP_USR-${randomUUID()}-${randomUUID()}`
  const id = Math.floor(Math.random() * 1e12) + 1e11
  contasNoMp.set(token, {
    id, nickname: 'LOJA FICTICIA', tags: o.tags ?? ['normal'],
    ...(o.documento ? { identification: { type: 'CNPJ', number: o.documento } } : {}),
  })
  return { token, userId: String(id) }
}

async function conta(nome: string): Promise<Base & { adminId: string; auxId: string }> {
  const suf = randomUUID()
  const base = await semearContaBase(db, { prefixo: 'MPCRED', nome: `${nome} ${suf}`, cnpj: suf })
  const adminId = await semearUsuario(db, base, { papel: 'admin_geral' })
  const auxId = await semearUsuario(db, base, { papel: 'aux_adm' })
  return { ...base, adminId, auxId }
}
const comoAdmin = (c: { adminId: string }) => { sessao = { id: c.adminId, papel: 'admin_geral' } }

const dadosDoGrupo = async (grupoId: string) => (await execRows(sql`select nome, cnpj from grupos where id = ${grupoId}`))[0] as { nome: string; cnpj: string }
const editar = async (grupoId: string, extra: Record<string, unknown>) => {
  const g = await dadosDoGrupo(grupoId)
  return acoes.editarGrupoAction(grupoId, { nome: g.nome, cnpj: g.cnpj, ativo: true, ...extra })
}
const config = async (grupoId: string) => (await execRows(sql`select token, user_id, atualizado_por, ultima_importacao_em,
  ultimo_resumo, ultima_falha_em, ultima_falha_erro, titular_documento from mercadopago_config where grupo_id = ${grupoId}`))[0]

test('admin_geral grava o token cifrado e a conta do /users/me; a lista leva só "conectado" e o final', async () => {
  const a = await conta('A')
  comoAdmin(a)
  const { token, userId } = tokenDeConta()
  assert.deepEqual(await editar(a.grupoId, { mpToken: token }), { ok: true, dados: { aviso: null } })
  const c = await config(a.grupoId)
  assert.equal(c.user_id, userId)
  assert.equal(c.atualizado_por, a.adminId)
  assert.notEqual(c.token, token)
  assert.equal(String(c.token).includes(token), false)

  const linha = (await acoes.listarGruposAction()).find(g => g.id === a.grupoId)!
  assert.deepEqual([linha.mpConectado, linha.mpFinal], [true, userId.slice(-3)])
  const serializado = JSON.stringify(linha)
  assert.equal(serializado.includes(userId), false)
  assert.equal(serializado.includes(String(c.token)), false)
})

test('campo vazio mantém a credencial sem chamar o Mercado Pago; remover apaga', async () => {
  const a = await conta('A')
  comoAdmin(a)
  await editar(a.grupoId, { mpToken: tokenDeConta().token })
  const antes = await config(a.grupoId)
  chamadasMp = 0
  assert.deepEqual(await editar(a.grupoId, { mpToken: '' }), { ok: true, dados: { aviso: null } })
  assert.equal(chamadasMp, 0)
  assert.deepEqual(await config(a.grupoId), antes)

  assert.equal((await editar(a.grupoId, { mpRemover: true })).ok, true)
  assert.equal(await config(a.grupoId), undefined)
})

// #891: o servidor não confia no navegador.
test('pedido forjado: conta, autor e grupo saem do servidor, nunca dos campos a mais', async () => {
  const a = await conta('A')
  const b = await conta('B')
  comoAdmin(a)
  const { token, userId } = tokenDeConta()
  const r = await editar(a.grupoId, { mpToken: token, userId: 'forjado', user_id: 'forjado', atualizadoPor: b.adminId, grupoId: b.grupoId })
  assert.equal(r.ok, true)
  const c = await config(a.grupoId)
  assert.deepEqual([c.user_id, c.atualizado_por], [userId, a.adminId])
  assert.equal(await config(b.grupoId), undefined)
})

test('criar grupo com token forjado não grava credencial do Mercado Pago', async () => {
  const a = await conta('A')
  comoAdmin(a)
  const nome = `MPCRED novo ${randomUUID()}`
  const r = await acoes.criarGrupoAction({ nome, cnpj: '00000000000191', ativo: true, mpToken: tokenDeConta().token } as Parameters<typeof acoes.criarGrupoAction>[0])
  assert.deepEqual(r, { ok: true, dados: undefined })
  const [novo] = await execRows(sql`select g.id, c.grupo_id as cfg from grupos g left join mercadopago_config c on c.grupo_id = g.id where g.nome = ${nome}`)
  assert.equal(novo.cfg, null)
  assert.equal(chamadasMp, 0)
})

test('a conta do Mercado Pago já ligada a um grupo de outra Conta: mesma frase, e nada do grupo muda', async () => {
  const a = await conta('A')
  const b = await conta('B')
  comoAdmin(a)
  const { token } = tokenDeConta()
  await editar(b.grupoId, { mpToken: token })
  const r = await acoes.editarGrupoAction(a.grupoId, { nome: 'Nome novo que não grava', cnpj: (await dadosDoGrupo(a.grupoId)).cnpj, ativo: true, mpToken: token })
  assert.deepEqual(r, { ok: false, erro: FRASES_MP.jaLigada })
  assert.notEqual((await dadosDoGrupo(a.grupoId)).nome, 'Nome novo que não grava')
  assert.equal(await config(a.grupoId), undefined)
})

test('token recusado pelo Mercado Pago volta como frase (não como erro lançado) e nada grava', async () => {
  const a = await conta('A')
  comoAdmin(a)
  const r = await editar(a.grupoId, { mpToken: `APP_USR-${randomUUID()}-desconhecido` })
  assert.deepEqual(r, { ok: false, erro: FRASES_MP.recusado })
  assert.equal(await config(a.grupoId), undefined)
})

// #404: com throw, o build de produção troca a frase por "Minified React error #441".
test('recusas de criar e editar voltam como valor: nome vazio, Conta inexistente, grupo inexistente', async () => {
  const a = await conta('A')
  comoAdmin(a)
  const valor = <T,>(p: Promise<T>) => p.catch((e: Error) => ({ lancou: e.message }))
  assert.deepEqual(await valor(acoes.criarGrupoAction({ nome: ' ', cnpj: '1', ativo: true })), { ok: false, erro: 'Nome obrigatório' })
  assert.deepEqual(await valor(acoes.criarGrupoAction({ nome: 'X', cnpj: '1', ativo: true, contaId: randomUUID() })), { ok: false, erro: 'Conta não encontrada' })
  assert.deepEqual(await valor(acoes.editarGrupoAction(a.grupoId, { nome: 'X', cnpj: '', ativo: true })), { ok: false, erro: 'CNPJ obrigatório' })
  chamadasMp = 0
  for (const id of [randomUUID(), 'nao-e-uuid']) {
    assert.deepEqual(await valor(acoes.editarGrupoAction(id, { nome: 'X', cnpj: '1', ativo: true, mpToken: tokenDeConta().token })), { ok: false, erro: 'Grupo não encontrado' })
  }
  assert.equal(chamadasMp, 0)
  assert.deepEqual(await valor(acoes.editarGrupoAction(a.grupoId, { nome: 'X', cnpj: '1', ativo: true, mcpaiEndpointUrl: 'http://x' })),
    { ok: false, erro: 'A chave do mcp.ai precisa ser a URL do endpoint, começando com https://' })
})

test('quem não é admin_geral é recusado no início, sem chamar o Mercado Pago', async () => {
  const a = await conta('A')
  for (const papel of ['aux_adm', 'admin_socio']) {
    sessao = { id: a.auxId, papel }
    assert.deepEqual(await editar(a.grupoId, { mpToken: tokenDeConta().token }), { ok: false, erro: 'Acesso restrito ao Admin Geral' })
  }
  assert.equal(chamadasMp, 0)
  assert.equal(await config(a.grupoId), undefined)
})

test('token novo apaga a falha da última rodada; outra conta apaga também o resumo e a hora', async () => {
  const a = await conta('A')
  comoAdmin(a)
  const primeira = tokenDeConta()
  await editar(a.grupoId, { mpToken: primeira.token })
  const marcarRodadas = () => db.execute(sql`update mercadopago_config set ultima_importacao_em = now(), ultimo_resumo = '{"pendentes":1}'::jsonb,
    ultima_falha_em = now(), ultima_falha_erro = 'falhou' where grupo_id = ${a.grupoId}`)

  // Outro token da mesma conta: o resumo segue, a falha some.
  await marcarRodadas()
  const mesmaConta = `APP_USR-${randomUUID()}-mesma-conta`
  contasNoMp.set(mesmaConta, contasNoMp.get(primeira.token)!)
  await editar(a.grupoId, { mpToken: mesmaConta })
  let c = await config(a.grupoId)
  assert.deepEqual([c.ultimo_resumo, c.ultima_falha_em, c.ultima_falha_erro], [{ pendentes: 1 }, null, null])
  assert.notEqual(c.ultima_importacao_em, null)

  // Conta diferente: nada da antiga fica.
  await marcarRodadas()
  const outra = tokenDeConta()
  await editar(a.grupoId, { mpToken: outra.token })
  c = await config(a.grupoId)
  assert.deepEqual([c.user_id, c.ultima_importacao_em, c.ultimo_resumo, c.ultima_falha_em, c.ultima_falha_erro], [outra.userId, null, null, null, null])
})

// Decisão do Luis (#51): o aviso de CNPJ fica guardado e aparece no diálogo; a lista compara na hora e manda só o booleano.
test('titular de outro CNPJ: grava só os dígitos, a lista avisa sem mandar o documento e acompanha a edição do CNPJ', async () => {
  const a = await conta('A')
  comoAdmin(a)
  const outro = '99.888.777/0001-00'
  const { token } = tokenDeConta({ documento: outro })
  const r = await editar(a.grupoId, { mpToken: token })
  assert.equal(r.ok && r.dados.aviso, FRASES_MP.outroCnpj)
  assert.equal((await config(a.grupoId)).titular_documento, '99888777000100')

  const linha = async () => (await acoes.listarGruposAction()).find(g => g.id === a.grupoId)!
  assert.equal((await linha()).mpOutroCnpj, true)
  assert.equal(JSON.stringify(await linha()).includes('99888777000100'), false)
  assert.equal(JSON.stringify(await linha()).includes(outro), false)

  // O grupo passa a ter o CNPJ do titular: o aviso some sem gravar a credencial de novo.
  await editar(a.grupoId, { cnpj: outro })
  assert.equal((await linha()).mpOutroCnpj, false)
})

test('Mercado Pago sem o documento do titular: grava nulo e não avisa', async () => {
  const a = await conta('A')
  comoAdmin(a)
  await editar(a.grupoId, { mpToken: tokenDeConta().token })
  assert.equal((await config(a.grupoId)).titular_documento, null)
  assert.equal((await acoes.listarGruposAction()).find(g => g.id === a.grupoId)!.mpOutroCnpj, false)
})

// #236: contas de outro CNPJ liberadas para a tela PIX. Só grupo com chave própria do mcp.ai.
const CHAVE_PROPRIA = 'https://api.mcp.ai/ficticia/token-ficticio-0001'
const idsPix = async (grupoId: string) => ((await execRows(sql`select mcpai_contas_pix_ids as ids from grupos where id = ${grupoId}`))[0] as { ids: string[] }).ids
const comChavePropria = async (grupoId: string) => { assert.equal((await editar(grupoId, { mcpaiEndpointUrl: CHAVE_PROPRIA })).ok, true) }

test('admin_geral libera ids em grupo com chave própria; a lista devolve os ids e nunca a chave', async () => {
  const a = await conta('A')
  comoAdmin(a)
  await comChavePropria(a.grupoId)
  assert.deepEqual(await editar(a.grupoId, { mcpaiContasPix: 'conta-1, conta-2' }), { ok: true, dados: { aviso: null } })
  assert.deepEqual(await idsPix(a.grupoId), ['conta-1', 'conta-2'])
  const linha = (await acoes.listarGruposAction()).find(g => g.id === a.grupoId)!
  assert.deepEqual(linha.mcpaiContasPixIds, ['conta-1', 'conta-2'])
  assert.equal(JSON.stringify(linha).includes('token-ficticio-0001'), false)
})

test('grupo sem chave própria (usa a global da env): recusa os ids e nada grava', async () => {
  const a = await conta('A')
  comoAdmin(a)
  const antes = await dadosDoGrupo(a.grupoId)
  const r = await acoes.editarGrupoAction(a.grupoId, { nome: 'Nome que não grava', cnpj: antes.cnpj, ativo: true, mcpaiContasPix: 'conta-1' })
  assert.equal(r.ok, false)
  assert.match(r.ok ? '' : r.erro, /chave própria/)
  assert.deepEqual(await idsPix(a.grupoId), [])
  assert.equal((await dadosDoGrupo(a.grupoId)).nome, antes.nome)
})

test('pedido forjado: usuário da Conta B não grava ids no grupo da Conta A', async () => {
  const a = await conta('A')
  const b = await conta('B')
  comoAdmin(a)
  await comChavePropria(a.grupoId)
  for (const papel of ['aux_adm', 'admin_socio']) {
    sessao = { id: b.auxId, papel }
    assert.deepEqual(await editar(a.grupoId, { mcpaiContasPix: 'conta-de-a' }), { ok: false, erro: 'Acesso restrito ao Admin Geral' })
  }
  assert.deepEqual(await idsPix(a.grupoId), [])
  assert.deepEqual(await idsPix(b.grupoId), [])
})

test('pedido forjado: campos a mais (grupo, conta e o nome da coluna) não mudam o grupo de outra Conta', async () => {
  const a = await conta('A')
  const b = await conta('B')
  comoAdmin(a)
  await comChavePropria(a.grupoId)
  await comChavePropria(b.grupoId)
  const r = await editar(a.grupoId, { mcpaiContasPix: 'so-da-a', mcpaiContasPixIds: ['forjado'], grupoId: b.grupoId, contaId: b.contaId })
  assert.equal(r.ok, true)
  assert.deepEqual(await idsPix(a.grupoId), ['so-da-a'])
  assert.deepEqual(await idsPix(b.grupoId), [])
  assert.equal((await execRows(sql`select conta_id from grupos where id = ${a.grupoId}`))[0].conta_id, a.contaId)
})

test('campo vazio apaga os ids; campo ausente não mexe', async () => {
  const a = await conta('A')
  comoAdmin(a)
  await comChavePropria(a.grupoId)
  await editar(a.grupoId, { mcpaiContasPix: 'conta-1' })
  await editar(a.grupoId, { nome: 'Outro nome' })
  assert.deepEqual(await idsPix(a.grupoId), ['conta-1'])
  await editar(a.grupoId, { mcpaiContasPix: '' })
  assert.deepEqual(await idsPix(a.grupoId), [])
})

test('remover a chave apaga os ids junto; remover e mandar ids no mesmo pedido é recusado', async () => {
  const a = await conta('A')
  comoAdmin(a)
  await comChavePropria(a.grupoId)
  await editar(a.grupoId, { mcpaiContasPix: 'conta-1' })
  const recusa = await editar(a.grupoId, { mcpaiRemover: true, mcpaiContasPix: 'conta-1' })
  assert.equal(recusa.ok, false)
  assert.deepEqual(await idsPix(a.grupoId), ['conta-1'])
  assert.equal((await editar(a.grupoId, { mcpaiRemover: true })).ok, true)
  assert.deepEqual(await idsPix(a.grupoId), [])
})

test('id com caractere inválido é recusado e nada grava', async () => {
  const a = await conta('A')
  comoAdmin(a)
  await comChavePropria(a.grupoId)
  const r = await editar(a.grupoId, { mcpaiContasPix: 'conta-1, b!2' })
  assert.equal(r.ok, false)
  assert.deepEqual(await idsPix(a.grupoId), [])
})

test('pedido forjado: ids que não são texto (número, nulo, objeto, lista) voltam como recusa e nada grava', async () => {
  const a = await conta('A')
  comoAdmin(a)
  await comChavePropria(a.grupoId)
  await editar(a.grupoId, { mcpaiContasPix: 'conta-1' })
  const valor = <T,>(p: Promise<T>) => p.catch((e: Error) => ({ lancou: e.message }))
  for (const forjado of [42, null, { a: 1 }, ['conta-9']]) {
    const r = await valor(editar(a.grupoId, { mcpaiContasPix: forjado }))
    assert.equal((r as { ok?: boolean }).ok, false, `valor ${JSON.stringify(forjado)}: ${JSON.stringify(r)}`)
  }
  assert.deepEqual(await idsPix(a.grupoId), ['conta-1'])
})

// #253: rótulo ao lado de cada ID. Só admin_geral, grupo lido pelo id no servidor, só com chave própria.
const chaveDe = (nome: string) => `https://api.mcp.ai/ficticia/${nome}-${randomUUID()}`
const NUMERO_DA_CONTA = '12345-6'
const BANK = (nome: string, itemId: string) => [
  { id: `${nome}-c1`, item_id: itemId, bank: `Banco ${nome}`, subtype: 'CHECKING_ACCOUNT', number: NUMERO_DA_CONTA, taxNumber: '99999999000199' },
  { id: `${nome}-c2`, item_id: itemId, bank: `Banco ${nome}`, subtype: 'CHECKING_ACCOUNT', number: '77777-7', taxNumber: '99999999000199' },
]
async function grupoComChave(nome: string) {
  const g = await conta(nome)
  comoAdmin(g)
  const chave = chaveDe(nome)
  assert.equal((await editar(g.grupoId, { mcpaiEndpointUrl: chave })).ok, true)
  contasDaChave.set(chave, { bank: BANK(nome, `cred-${nome}`), credit: [] })
  return { ...g, chave }
}

test('admin_geral recebe os rótulos do grupo com chave própria, sem a chave, o número da conta nem o CNPJ', async () => {
  const a = await grupoComChave('A')
  comoAdmin(a)
  const r = await acoes.rotulosDosIdsAction(a.grupoId)
  assert.deepEqual(r, { ok: true, dados: [
    { id: 'A-c1', texto: 'Banco A, conta' },
    { id: 'A-c2', texto: 'Banco A, conta' },
    { id: 'cred-A', texto: 'Banco A, credencial, 2 contas correntes' },
  ] })
  const saida = JSON.stringify(r)
  for (const proibido of [a.chave, 'ficticia', NUMERO_DA_CONTA, '99999999000199']) assert.equal(saida.includes(proibido), false, `vazou: ${proibido}`)
  assert.deepEqual([...new Set(chavesUsadas)], [a.chave])
})

test('pelo id do grupo: cada grupo fala com a sua chave, mesmo com dois grupos de mesmo CNPJ', async () => {
  const a = await grupoComChave('A')
  const b = await grupoComChave('B')
  await execRows(sql`update grupos set cnpj = (select cnpj from grupos where id = ${a.grupoId}) where id = ${b.grupoId}`)
  comoAdmin(a)
  chavesUsadas.length = 0
  await acoes.rotulosDosIdsAction(b.grupoId)
  assert.deepEqual([...new Set(chavesUsadas)], [b.chave])
})

test('pedido forjado: usuário de outra Conta recebe a mesma recusa para grupo existente e inexistente, sem falar com o mcp.ai', async () => {
  const a = await grupoComChave('A')
  const b = await conta('B')
  for (const papel of ['aux_adm', 'admin_socio']) {
    sessao = { id: b.auxId, papel }
    const recusaDoExistente = await acoes.rotulosDosIdsAction(a.grupoId)
    const recusaDoInexistente = await acoes.rotulosDosIdsAction(randomUUID())
    assert.deepEqual(recusaDoExistente, { ok: false, erro: 'Acesso restrito ao Admin Geral' })
    assert.deepEqual(recusaDoInexistente, recusaDoExistente)
  }
  assert.deepEqual(chavesUsadas, [])
})

test('grupo inexistente e id que não é uuid recebem a mesma frase', async () => {
  const a = await conta('A')
  comoAdmin(a)
  const esperado = { ok: false, erro: 'Grupo não encontrado' }
  assert.deepEqual(await acoes.rotulosDosIdsAction(randomUUID()), esperado)
  assert.deepEqual(await acoes.rotulosDosIdsAction("x' or '1'='1"), esperado)
  assert.deepEqual(chavesUsadas, [])
})

test('grupo sem chave própria devolve vazio e não fala com o mcp.ai, mesmo com ids gravados por fora', async () => {
  const a = await conta('A')
  comoAdmin(a)
  await execRows(sql`update grupos set mcpai_contas_pix_ids = ${sql.param(['conta-gravada'])}::text[] where id = ${a.grupoId}`)
  assert.deepEqual(await acoes.rotulosDosIdsAction(a.grupoId), { ok: true, dados: [] })
  assert.deepEqual(chavesUsadas, [])
})

test('erro do mcp.ai vira a frase genérica, sem a chave nem o corpo do erro', async () => {
  const a = await grupoComChave('A')
  comoAdmin(a)
  mcpFalha = true
  const r = await acoes.rotulosDosIdsAction(a.grupoId)
  assert.deepEqual(r, { ok: false, erro: 'Não foi possível consultar o mcp.ai agora.' })
  assert.equal(JSON.stringify(r).includes('recusou'), false)
})
