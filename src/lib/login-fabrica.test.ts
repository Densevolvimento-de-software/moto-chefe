import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ROTA_PAINEL_FABRICA } from './painel-fabrica'
import { ROTA_CONTA_DESATIVADA, ROTA_SAIR, decisaoDoLoginFabrica, ehPedidoDeAcao, saidaDeOutroSite } from './login-fabrica'

const decide = (metodo: string, caminho: string) => decisaoDoLoginFabrica({ caminho, metodo })
const SEGUIR = { tipo: 'seguir' }
const RECUSAR = { tipo: 'recusar' }
const AO_PAINEL = { tipo: 'redirecionar', para: ROTA_PAINEL_FABRICA }

test('lê o painel, o impresso e a tela de conta desativada', () => {
  assert.deepEqual(decide('GET', ROTA_PAINEL_FABRICA), SEGUIR)
  assert.deepEqual(decide('GET', `${ROTA_PAINEL_FABRICA}/imprimir`), SEGUIR)
  assert.deepEqual(decide('HEAD', ROTA_PAINEL_FABRICA), SEGUIR)
  assert.deepEqual(decide('GET', ROTA_CONTA_DESATIVADA), SEGUIR)
})

test('qualquer outro endereço volta ao painel, inclusive um que só começa igual', () => {
  for (const caminho of ['/dashboard', '/admin/usuarios', '/login', '/trocar-senha', `${ROTA_PAINEL_FABRICA}x`, '/']) {
    assert.deepEqual(decide('GET', caminho), AO_PAINEL, caminho)
  }
})

test('só lê: POST, PUT, PATCH e DELETE são recusados, inclusive no próprio painel (Server Action)', () => {
  for (const metodo of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    assert.deepEqual(decide(metodo, ROTA_PAINEL_FABRICA), RECUSAR, metodo)
    assert.deepEqual(decide(metodo, '/admin/usuarios'), RECUSAR, metodo)
  }
})

test('o único POST aceito é o de sair', () => {
  assert.deepEqual(decide('POST', ROTA_SAIR), SEGUIR)
  assert.deepEqual(decide('DELETE', ROTA_SAIR), RECUSAR)
})

test('método em minúsculas vale igual', () => {
  assert.deepEqual(decide('post', ROTA_PAINEL_FABRICA), RECUSAR)
  assert.deepEqual(decide('get', ROTA_PAINEL_FABRICA), SEGUIR)
})

test('pedido de ação: cabeçalho de action, ou formulário multipart ou urlencoded mesmo sem o cabeçalho', () => {
  const pedido = (h: Record<string, string>) => ehPedidoDeAcao(new Headers(h))
  assert.equal(pedido({ 'next-action': 'abc123' }), true)
  assert.equal(pedido({ 'content-type': 'multipart/form-data; boundary=----x' }), true)
  assert.equal(pedido({ 'content-type': 'application/x-www-form-urlencoded' }), true)
  assert.equal(pedido({ 'Content-Type': 'Multipart/Form-Data; boundary=x' }), true)
})

test('leitura de página não é pedido de ação', () => {
  assert.equal(ehPedidoDeAcao(new Headers()), false)
  assert.equal(ehPedidoDeAcao(new Headers({ accept: 'text/html', rsc: '1' })), false)
})

test('sair: formulário de outro site é recusado; o do próprio MOVA e o sem origem passam', () => {
  const site = 'https://www.meumova.com'
  assert.equal(saidaDeOutroSite('https://atacante.example', site), true)
  assert.equal(saidaDeOutroSite('https://www.meumova.com', site), false)
  assert.equal(saidaDeOutroSite(null, site), false)
})
