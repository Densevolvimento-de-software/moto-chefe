import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chavePropriaAposSalvar, contaEntraNoPix, idsContasPixDoPedido, idsContasPixParaGravar, lerIdsContasPix } from './pix-contas-liberadas'

const DO_GRUPO = { id: 'conta-grupo', doCnpjDoGrupo: true }
const DE_OUTRO = { id: 'conta-outra', doCnpjDoGrupo: false }

test('conta do CNPJ do grupo entra no PIX com ou sem chave própria, sem nenhum id liberado', () => {
  assert.equal(contaEntraNoPix(DO_GRUPO, { chavePropria: true, ids: [] }), true)
  assert.equal(contaEntraNoPix(DO_GRUPO, { chavePropria: false, ids: [] }), true)
})

test('conta de outro CNPJ sem id liberado fica fora', () => {
  assert.equal(contaEntraNoPix(DE_OUTRO, { chavePropria: true, ids: ['outro-id'] }), false)
})

test('conta de outro CNPJ com id liberado e chave própria entra', () => {
  assert.equal(contaEntraNoPix(DE_OUTRO, { chavePropria: true, ids: ['conta-outra'] }), true)
})

test('id liberado sem chave própria (chave global) não vale', () => {
  assert.equal(contaEntraNoPix(DE_OUTRO, { chavePropria: false, ids: ['conta-outra'] }), false)
})

test('lerIdsContasPix separa por vírgula, espaço e quebra de linha, sem vazios nem repetidos', () => {
  assert.deepEqual(lerIdsContasPix('a1, b2\nc3  a1,'), { ok: true, ids: ['a1', 'b2', 'c3'] })
  assert.deepEqual(lerIdsContasPix('  '), { ok: true, ids: [] })
})

test('lerIdsContasPix aceita ponto no id e recusa o resto fora de letra, número, - e _', () => {
  assert.deepEqual(lerIdsContasPix('a.1, b_2-c'), { ok: true, ids: ['a.1', 'b_2-c'] })
  assert.equal(lerIdsContasPix('a1, b!2').ok, false)
  assert.equal(lerIdsContasPix('a/1').ok, false)
})

test('lerIdsContasPix recusa mais de 20 ids e id com mais de 100 caracteres', () => {
  const vinteEUm = Array.from({ length: 21 }, (_, i) => `id${i}`).join(',')
  assert.equal(lerIdsContasPix(vinteEUm).ok, false)
  assert.equal(lerIdsContasPix('x'.repeat(101)).ok, false)
  assert.equal(lerIdsContasPix('x'.repeat(100)).ok, true)
})

test('chavePropriaAposSalvar: remover vence; senão vale a chave nova ou a que já existia', () => {
  assert.equal(chavePropriaAposSalvar({ jaTinha: true, chaveNova: false, remover: false }), true)
  assert.equal(chavePropriaAposSalvar({ jaTinha: true, chaveNova: false, remover: true }), false)
  assert.equal(chavePropriaAposSalvar({ jaTinha: true, chaveNova: true, remover: true }), false)
  assert.equal(chavePropriaAposSalvar({ jaTinha: false, chaveNova: true, remover: false }), true)
  assert.equal(chavePropriaAposSalvar({ jaTinha: false, chaveNova: false, remover: false }), false)
})

test('idsContasPixParaGravar: id sem chave própria é recusado; vazio sempre pode; com chave grava', () => {
  const recusa = idsContasPixParaGravar({ texto: 'a1', chavePropriaAposSalvar: false })
  assert.equal(recusa.ok, false)
  assert.match(recusa.ok ? '' : recusa.erro, /chave própria/)
  assert.deepEqual(idsContasPixParaGravar({ texto: '', chavePropriaAposSalvar: false }), { ok: true, ids: [] })
  assert.deepEqual(idsContasPixParaGravar({ texto: 'a1, b2', chavePropriaAposSalvar: true }), { ok: true, ids: ['a1', 'b2'] })
  assert.equal(idsContasPixParaGravar({ texto: 'a!', chavePropriaAposSalvar: true }).ok, false)
})

test('idsContasPixDoPedido: campo ausente não mexe; vazio apaga; remover a chave apaga e recusa id junto', () => {
  const tem = { jaTinha: true, chaveNova: false }
  assert.deepEqual(idsContasPixDoPedido({ texto: undefined, ...tem, remover: false }), { ok: true, ids: undefined })
  assert.deepEqual(idsContasPixDoPedido({ texto: '', ...tem, remover: false }), { ok: true, ids: [] })
  assert.deepEqual(idsContasPixDoPedido({ texto: 'a1', ...tem, remover: false }), { ok: true, ids: ['a1'] })
  assert.deepEqual(idsContasPixDoPedido({ texto: undefined, ...tem, remover: true }), { ok: true, ids: [] })
  assert.equal(idsContasPixDoPedido({ texto: 'a1', ...tem, remover: true }).ok, false)
  assert.equal(idsContasPixDoPedido({ texto: 'a1', jaTinha: false, chaveNova: false, remover: false }).ok, false)
  assert.deepEqual(idsContasPixDoPedido({ texto: 'a1', jaTinha: false, chaveNova: true, remover: false }), { ok: true, ids: ['a1'] })
})

test('idsContasPixDoPedido: valor que não é texto (pedido forjado) é recusado, não lança', () => {
  const base = { jaTinha: true, chaveNova: false, remover: false }
  for (const forjado of [42, null, { a: 1 }, ['a1'], true]) {
    const r = idsContasPixDoPedido({ texto: forjado as unknown as string, ...base })
    assert.equal(r.ok, false, `valor ${JSON.stringify(forjado)} devia ser recusado`)
  }
})
