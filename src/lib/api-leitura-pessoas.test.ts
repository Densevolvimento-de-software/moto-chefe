import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  codificarCursorDePessoas, ehPessoaQueSai, lerCursorDePessoas, linhaDaPessoa, papelDePessoa, papelEfetivo, type LinhaPessoaBanco,
} from './api-leitura-pessoas'

const ID = '0195f2a4-6c1e-7000-8000-000000000001'
const LOJA = { lojaId: '0195f2a4-6c1e-7000-8000-0000000000aa', lojaNome: 'Loja Sintética Pessoas' }
const base64 = (valor: unknown) => Buffer.from(JSON.stringify(valor)).toString('base64url')
const SEM_EXTRA = { papeisExtras: [] as string[] }

test('vendedor, aux_adm e mecânico de loja que sai são pessoa que sai', () => {
  for (const papel of ['vendedor', 'aux_adm', 'mecanico']) {
    assert.equal(ehPessoaQueSai({ papel, cargo: null, lojaQueSai: true, contaQueSai: false, ...SEM_EXTRA }), true, papel)
  }
})

test('vendedor de loja que não sai não é pessoa, mesmo com a Conta que sai', () => {
  assert.equal(ehPessoaQueSai({ papel: 'vendedor', cargo: null, lojaQueSai: false, contaQueSai: true, ...SEM_EXTRA }), false)
})

test('sócio sai pela Conta: com loja que sai na Conta, sai; sem loja que sai, não sai', () => {
  assert.equal(ehPessoaQueSai({ papel: 'admin_socio', cargo: null, lojaQueSai: false, contaQueSai: true, ...SEM_EXTRA }), true)
  assert.equal(ehPessoaQueSai({ papel: 'admin_socio', cargo: null, lojaQueSai: false, contaQueSai: false, ...SEM_EXTRA }), false)
})

test('admin_geral não é pessoa que sai, mesmo com a Conta que sai', () => {
  assert.equal(ehPessoaQueSai({ papel: 'admin_geral', cargo: null, lojaQueSai: true, contaQueSai: true, ...SEM_EXTRA }), false)
})

test('cargo vale o papel base do cargo: mecânico entra pela loja; sócio de cargo entra pela Conta', () => {
  const mecanico = { nome: 'Chefe de oficina', papelBase: 'mecanico' as const }
  const socio = { nome: 'Sócio de cargo', papelBase: 'admin_socio' as const }
  assert.equal(ehPessoaQueSai({ papel: 'cargo', cargo: mecanico, lojaQueSai: true, contaQueSai: false, ...SEM_EXTRA }), true)
  assert.equal(ehPessoaQueSai({ papel: 'cargo', cargo: socio, lojaQueSai: false, contaQueSai: true, ...SEM_EXTRA }), true)
})

test('papel extra de pessoa conta: motorista com extra vendedor, na loja que sai, é pessoa', () => {
  assert.equal(ehPessoaQueSai({ papel: 'motorista', cargo: null, lojaQueSai: true, contaQueSai: false, papeisExtras: ['vendedor'] }), true)
})

test('papel extra que não é de pessoa não conta: motorista com extra admin_geral não é pessoa', () => {
  assert.equal(ehPessoaQueSai({ papel: 'motorista', cargo: null, lojaQueSai: true, contaQueSai: true, papeisExtras: ['admin_geral'] }), false)
})

test('extra de sócio segue a regra do sócio: pela Conta, não pela loja', () => {
  assert.equal(ehPessoaQueSai({ papel: 'motorista', cargo: null, lojaQueSai: true, contaQueSai: false, papeisExtras: ['admin_socio'] }), false)
  assert.equal(ehPessoaQueSai({ papel: 'motorista', cargo: null, lojaQueSai: false, contaQueSai: true, papeisExtras: ['admin_socio'] }), true)
})

test('função é o papel de pessoa principal; sem principal de pessoa, o primeiro extra de pessoa', () => {
  assert.equal(papelDePessoa({ papel: 'aux_adm', cargo: null, papeisExtras: ['vendedor'] }), 'aux_adm')
  assert.equal(papelDePessoa({ papel: 'motorista', cargo: null, papeisExtras: ['fabrica', 'mecanico', 'admin_socio'] }), 'mecanico')
  assert.equal(papelDePessoa({ papel: 'motorista', cargo: null, papeisExtras: ['admin_geral'] }), null)
})

test('função é o papel efetivo: cargo sai com o papel base, não com o nome do cargo', () => {
  assert.equal(papelEfetivo({ papel: 'cargo', cargo: { nome: 'Chefe de oficina', papelBase: 'mecanico' } }), 'mecanico')
  assert.equal(papelEfetivo({ papel: 'vendedor', cargo: null }), 'vendedor')
})

test('a linha sai só com id, nome, função, loja (id e nome) e ativo', () => {
  const linha: LinhaPessoaBanco = {
    id: ID, nome: 'Pessoa Sintética', papel: 'vendedor', ativo: false, papeisExtras: [],
    cargoNome: null, cargoPapelBase: null, ...LOJA,
  }
  const saida = linhaDaPessoa(linha)
  assert.deepEqual(Object.keys(saida).sort(), ['ativo', 'funcao', 'id', 'loja', 'nome'])
  assert.deepEqual(Object.keys(saida.loja!).sort(), ['id', 'nome'])
  assert.deepEqual(saida, {
    id: ID, nome: 'Pessoa Sintética', funcao: 'vendedor', loja: { id: LOJA.lojaId, nome: LOJA.lojaNome }, ativo: false,
  })
})

test('sócio sai com loja nula, mesmo que a linha traga uma loja', () => {
  const saida = linhaDaPessoa({
    id: ID, nome: 'Sócio Sintético', papel: 'admin_socio', ativo: true, papeisExtras: [],
    cargoNome: null, cargoPapelBase: null, ...LOJA,
  })
  assert.equal(saida.funcao, 'admin_socio')
  assert.equal(saida.loja, null)
})

test('linha de cargo mostra a função do papel base; motorista com extra vendedor mostra vendedor', () => {
  const cargo = linhaDaPessoa({
    id: ID, nome: 'Pessoa Sintética', papel: 'cargo', ativo: true, papeisExtras: [],
    cargoNome: 'Chefe de oficina', cargoPapelBase: 'mecanico', ...LOJA,
  })
  assert.equal(cargo.funcao, 'mecanico')
  const extra = linhaDaPessoa({
    id: ID, nome: 'Pessoa Sintética', papel: 'motorista', ativo: true, papeisExtras: ['vendedor'],
    cargoNome: null, cargoPapelBase: null, ...LOJA,
  })
  assert.equal(extra.funcao, 'vendedor')
})

test('cursor sem texto é a primeira página; cursor de id válido volta igual', () => {
  assert.deepEqual(lerCursorDePessoas(null), { ok: true, cursor: null })
  const texto = codificarCursorDePessoas({ i: ID })
  assert.deepEqual(lerCursorDePessoas(texto), { ok: true, cursor: { i: ID } })
})

test('cursor que não é base64 de objeto, ou com id que não é UUID, não vale', () => {
  assert.deepEqual(lerCursorDePessoas('não é base64!'), { ok: false })
  assert.deepEqual(lerCursorDePessoas(base64(['x'])), { ok: false })
  assert.deepEqual(lerCursorDePessoas(base64({ i: 'não-uuid' })), { ok: false })
  assert.deepEqual(lerCursorDePessoas(base64({ i: 42 })), { ok: false })
})

test('cursor com campo a mais, ou de outro conjunto, não vale', () => {
  assert.deepEqual(lerCursorDePessoas(base64({ i: ID, d: '2026-01-01T00:00:00.000Z' })), { ok: false })
  assert.deepEqual(lerCursorDePessoas(base64({ d: '2026-01-01T00:00:00.000Z', n: 1 })), { ok: false })
})
