import { test } from 'node:test'
import assert from 'node:assert/strict'
import { conferirCredencialMp, credencialMpParaTela, FRASES_MP, type DependenciasCredencialMp } from './credencial'
import { ErroMercadoPago } from './cliente'
import type { ContaMp } from './point'

const TOKEN = 'APP_USR-0000000000000000-000000-ficticio00000000000000000000-000000000'
const CNPJ = '11.222.333/0001-81'
const conta = (o: Partial<ContaMp> = {}): ContaMp => ({ id: '4820482', nickname: 'LOJA', tags: ['normal'], documento: '11222333000181', ...o })
const deps = (o: Partial<DependenciasCredencialMp> = {}): DependenciasCredencialMp => ({
  consultarConta: async () => conta(), contaDaMensalidade: async () => '999', producao: true, ...o,
})
const recusa = (erro: string) => ({ ok: false, erro })

test('token novo conferido vira plano de gravar, com a conta do /users/me', async () => {
  let consultado = ''
  const r = await conferirCredencialMp({ mpToken: `  ${TOKEN}  ` }, CNPJ, deps({ consultarConta: async t => { consultado = t; return conta() } }))
  assert.deepEqual(r, { ok: true, plano: { acao: 'gravar', token: TOKEN, userId: '4820482', aviso: null } })
  assert.equal(consultado, TOKEN)
})

test('campo vazio (ou não texto) mantém o que está gravado, sem chamar o Mercado Pago', async () => {
  for (const mpToken of ['', '   ', undefined, 123, { token: TOKEN }]) {
    const r = await conferirCredencialMp({ mpToken }, CNPJ, deps({ consultarConta: async () => { throw new Error('não devia chamar') } }))
    assert.deepEqual(r, { ok: true, plano: { acao: 'manter' } })
  }
})

test('remover vence o token, mas só com true de verdade', async () => {
  assert.deepEqual(await conferirCredencialMp({ mpRemover: true, mpToken: TOKEN }, CNPJ, deps()), { ok: true, plano: { acao: 'remover' } })
  const r = await conferirCredencialMp({ mpRemover: 'true', mpToken: TOKEN }, CNPJ, deps())
  assert.equal(r.ok && r.plano.acao, 'gravar')
})

// #126 (decisão do Luis): token colado com espaço ou quebra de linha é normalizado antes de qualquer uso. O fetch
// com header inválido lança TypeError com o valor do header (o token) na mensagem.
test('token colado com quebra de linha, tab ou espaço no meio: normalizado antes de chamar o Mercado Pago', async () => {
  for (const colado of [`${TOKEN.slice(0, 20)}\n${TOKEN.slice(20)}`, `${TOKEN.slice(0, 20)}\r\n ${TOKEN.slice(20)}`, `\t${TOKEN.slice(0, 30)} ${TOKEN.slice(30)}\n`]) {
    let consultado = ''
    const r = await conferirCredencialMp({ mpToken: colado }, CNPJ, deps({ consultarConta: async t => { consultado = t; return conta() } }))
    assert.deepEqual(r, { ok: true, plano: { acao: 'gravar', token: TOKEN, userId: '4820482', aviso: null } })
    assert.equal(consultado, TOKEN)
  }
})

test('token fora do formato depois de normalizado (curto, caractere fora do visível): frase, sem chamar o MP e sem log', async t => {
  const log = t.mock.method(console, 'error', () => {})
  for (const mpToken of ['curto', `${TOKEN}\u0000x`, `${TOKEN}çã`]) {
    let chamou = false
    const r = await conferirCredencialMp({ mpToken }, CNPJ, deps({ consultarConta: async () => { chamou = true; return conta() } }))
    assert.deepEqual(r, recusa(FRASES_MP.formato))
    assert.equal(chamou, false)
  }
  assert.equal(log.mock.callCount(), 0)
})

test('401 e 403 do Mercado Pago: token recusado; o log não leva o token nem a mensagem do erro', async t => {
  const log = t.mock.method(console, 'error', () => {})
  for (const status of [401, 403]) {
    const r = await conferirCredencialMp({ mpToken: TOKEN }, CNPJ, deps({ consultarConta: async () => { throw new ErroMercadoPago(`falhou com ${TOKEN}`, status) } }))
    assert.deepEqual(r, recusa(FRASES_MP.recusado))
  }
  const linhas = log.mock.calls.map(c => c.arguments.map(String).join(' '))
  assert.deepEqual(linhas, ['[credencial-mp] /users/me falhou: HTTP 401', '[credencial-mp] /users/me falhou: HTTP 403'])
})

test('Mercado Pago fora (5xx, 429, timeout, rede): frase de indisponível, log só com o nome do erro', async t => {
  const log = t.mock.method(console, 'error', () => {})
  const erros = [new ErroMercadoPago('x', 500), new ErroMercadoPago('x', 429), new DOMException(`t ${TOKEN}`, 'TimeoutError'), new TypeError(`Bearer ${TOKEN}`)]
  for (const e of erros) {
    const r = await conferirCredencialMp({ mpToken: TOKEN }, CNPJ, deps({ consultarConta: async () => { throw e } }))
    assert.deepEqual(r, recusa(FRASES_MP.indisponivel))
  }
  const linhas = log.mock.calls.map(c => c.arguments.map(String).join(' '))
  assert.deepEqual(linhas, [
    '[credencial-mp] /users/me falhou: HTTP 500', '[credencial-mp] /users/me falhou: HTTP 429',
    '[credencial-mp] /users/me falhou: TimeoutError', '[credencial-mp] /users/me falhou: TypeError',
  ])
})

test('conta de teste: recusada em produção, aceita fora dela', async () => {
  const teste = async () => conta({ tags: ['normal', 'test_user'] })
  assert.deepEqual(await conferirCredencialMp({ mpToken: TOKEN }, CNPJ, deps({ consultarConta: teste, producao: true })), recusa(FRASES_MP.teste))
  const fora = await conferirCredencialMp({ mpToken: TOKEN }, CNPJ, deps({ consultarConta: teste, producao: false }))
  assert.equal(fora.ok && fora.plano.acao, 'gravar')
})

test('a conta da mensalidade do MOVA é recusada pela conta, não pelo texto do token', async () => {
  assert.deepEqual(await conferirCredencialMp({ mpToken: TOKEN }, CNPJ, deps({ contaDaMensalidade: async () => '4820482' })), recusa(FRASES_MP.mensalidade))
  // Sem a mensalidade configurada (ou ela fora do ar), não há com o que comparar.
  for (const contaDaMensalidade of [async () => null, async () => { throw new Error('fora') }]) {
    const r = await conferirCredencialMp({ mpToken: TOKEN }, CNPJ, deps({ contaDaMensalidade }))
    assert.equal(r.ok && r.plano.acao, 'gravar')
  }
})

// Decisão do Luis (#51): CNPJ do titular diferente do grupo = só aviso.
test('titular com outro CNPJ grava com aviso; sem documento, sem aviso', async () => {
  const outro = await conferirCredencialMp({ mpToken: TOKEN }, CNPJ, deps({ consultarConta: async () => conta({ documento: '99888777000100' }) }))
  assert.deepEqual(outro, { ok: true, plano: { acao: 'gravar', token: TOKEN, userId: '4820482', aviso: FRASES_MP.outroCnpj } })
  const semDoc = await conferirCredencialMp({ mpToken: TOKEN }, CNPJ, deps({ consultarConta: async () => conta({ documento: null }) }))
  assert.equal(semDoc.ok && semDoc.plano.acao === 'gravar' && semDoc.plano.aviso, null)
})

test('a tela leva só se há credencial e os 3 últimos dígitos da conta', () => {
  assert.deepEqual(credencialMpParaTela('123454820482'), { mpConectado: true, mpFinal: '482' })
  assert.deepEqual(credencialMpParaTela(null), { mpConectado: false, mpFinal: null })
})

// #126: nenhum log leva o token nem pedaço dele (8 caracteres seguidos), em nenhum caminho de erro.
test('nenhum console recebe o token nem pedaço dele, com o erro trazendo o token na mensagem', async t => {
  const saidas = (['log', 'info', 'warn', 'error'] as const).map(m => t.mock.method(console, m, () => {}))
  const comToken = [new ErroMercadoPago(`falhou ${TOKEN}`, 401), new ErroMercadoPago(`x ${TOKEN}`, 500), new TypeError(`Bearer ${TOKEN}`), new DOMException(TOKEN, 'TimeoutError')]
  for (const e of comToken) {
    await conferirCredencialMp({ mpToken: `${TOKEN.slice(0, 9)}\n${TOKEN.slice(9)}` }, CNPJ, deps({ consultarConta: async () => { throw e } }))
  }
  const escrito = saidas.flatMap(s => s.mock.calls.map(c => c.arguments.map(String).join(' '))).join('\n')
  assert.ok(escrito.length > 0, 'os erros deviam ter sido logados')
  for (let i = 0; i + 8 <= TOKEN.length; i++) assert.equal(escrito.includes(TOKEN.slice(i, i + 8)), false, `pedaço ${i} do token no log`)
})
