import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  CARENCIA_MS, chaveAceita, corpoDoErro, linhaDaLoja, planoDaTroca, statusDoErro, type LojaDaApi,
} from './api-leitura'

const AGORA = new Date('2026-11-27T12:00:00Z')
const emMs = (ms: number) => new Date(AGORA.getTime() + ms)

test('chave atual (sem validade e sem revogação) é aceita', () => {
  assert.equal(chaveAceita({ validaAte: null, revogadaEm: null }, AGORA), true)
})

test('chave revogada não é aceita, mesmo com validade futura', () => {
  assert.equal(chaveAceita({ validaAte: emMs(CARENCIA_MS), revogadaEm: AGORA }, AGORA), false)
})

test('chave com validade passada não é aceita; com validade futura é aceita até o instante da validade', () => {
  assert.equal(chaveAceita({ validaAte: emMs(-1), revogadaEm: null }, AGORA), false)
  assert.equal(chaveAceita({ validaAte: emMs(1), revogadaEm: null }, AGORA), true)
  assert.equal(chaveAceita({ validaAte: emMs(0), revogadaEm: null }, AGORA), false)
})

test('troca: a chave atual entra em carência de 24 horas e nada é revogado', () => {
  const plano = planoDaTroca([{ id: 'a', hash: 'h', validaAte: null, revogadaEm: null }], AGORA)
  assert.deepEqual(plano, { revogar: [], expirar: [{ id: 'a', validaAte: emMs(CARENCIA_MS) }] })
})

test('troca: chave já em carência é revogada na hora, e a atual entra em carência', () => {
  const plano = planoDaTroca([
    { id: 'antiga', hash: 'h1', validaAte: emMs(1000), revogadaEm: null },
    { id: 'atual', hash: 'h2', validaAte: null, revogadaEm: null },
  ], AGORA)
  assert.deepEqual(plano, { revogar: ['antiga'], expirar: [{ id: 'atual', validaAte: emMs(CARENCIA_MS) }] })
})

test('troca: chave vencida e ainda não revogada também sai (revogar)', () => {
  const plano = planoDaTroca([{ id: 'v', hash: 'h', validaAte: emMs(-1000), revogadaEm: null }], AGORA)
  assert.deepEqual(plano, { revogar: ['v'], expirar: [] })
})

test('linha da loja sai só com as seis colunas da spec, mesmo que o objeto traga mais campos', () => {
  const doBanco = {
    id: 'l1', nome: 'Loja 1', cidade: 'Belo Horizonte', endereco: 'Rua 1', cep: '30140071', ativa: true,
    grupoId: 'g1', lojaMotochefe: true, fabricaEmail: 'x@y.invalid',
  } as LojaDaApi
  const linha = linhaDaLoja(doBanco)
  assert.deepEqual(linha, { id: 'l1', nome: 'Loja 1', cidade: 'Belo Horizonte', endereco: 'Rua 1', cep: '30140071', ativa: true })
  assert.deepEqual(Object.keys(linha).sort(), ['ativa', 'cep', 'cidade', 'endereco', 'id', 'nome'])
})

test('erros têm código e frase numa lista só; acesso negado é 401 e erro interno é 500', () => {
  assert.deepEqual(corpoDoErro('acesso_negado'), { codigo: 'acesso_negado', frase: 'Acesso negado.' })
  assert.deepEqual(corpoDoErro('erro_interno'), { codigo: 'erro_interno', frase: 'Erro interno.' })
  assert.equal(statusDoErro('acesso_negado'), 401)
  assert.equal(statusDoErro('erro_interno'), 500)
})
