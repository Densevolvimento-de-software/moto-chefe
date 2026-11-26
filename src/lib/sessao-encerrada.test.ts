import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { SESSAO_ENCERRADA, ehSessaoEncerrada } from './sessao-encerrada'

test('erro com a frase de sessão encerrada é reconhecido', () => {
  assert.equal(ehSessaoEncerrada(new Error(SESSAO_ENCERRADA)), true)
})

test('outro erro, texto solto, nada ou objeto que só imita a mensagem não são sessão encerrada', () => {
  assert.equal(ehSessaoEncerrada(new Error('An unexpected response was received from the server.')), false)
  assert.equal(ehSessaoEncerrada(new Error('Minified React error #441')), false)
  assert.equal(ehSessaoEncerrada(SESSAO_ENCERRADA), false)
  assert.equal(ehSessaoEncerrada(undefined), false)
  assert.equal(ehSessaoEncerrada({ message: SESSAO_ENCERRADA }), false)
})

// ALARME DE ATUALIZAÇÃO DO NEXT, não prova de comportamento. O proxy responde 401 em texto porque o
// cliente do Next, ao receber status >= 400 com content-type exatamente "text/plain", rejeita a
// action com Error(corpo). Esse ramo não é documentado como API; o Next o usa nas próprias respostas.
// Se este teste falhar depois de atualizar o Next: rever a #281 no navegador (build de produção) antes
// de seguir. Sem o ramo, o Chegou volta à frase fixa e os outros botões ao texto em inglês de antes.
const REDUCER = join(process.cwd(), 'node_modules/next/dist/client/components/router-reducer/reducers/server-action-reducer.js')
const LE_CORPO_DO_ERRO = /res\.status\s*>=\s*400\s*&&\s*contentType\s*===\s*'text\/plain'\s*\?\s*await res\.text\(\)/
const LANCA_O_CORPO = /throw new Error\(message\)/

test('o cliente do Next instalado ainda usa o corpo text/plain de um 4xx como mensagem do erro da action', () => {
  const fonte = readFileSync(REDUCER, 'utf8')
  assert.match(fonte, LE_CORPO_DO_ERRO)
  assert.match(fonte, LANCA_O_CORPO)
})
