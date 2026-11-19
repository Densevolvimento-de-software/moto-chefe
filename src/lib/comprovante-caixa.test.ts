import { test } from 'node:test'
import assert from 'node:assert/strict'
import { caminhoDoComprovanteCaixa, lojaEfetivaDoLancamento, recusaDoComprovante } from './comprovante-caixa'

test('caminho do comprovante leva o grupo e a extensão do tipo', () => {
  assert.equal(caminhoDoComprovanteCaixa('g1', 'application/pdf', 'abc'), 'caixa/g1/abc.pdf')
  assert.equal(caminhoDoComprovanteCaixa('g1', 'image/jpeg', 'abc'), 'caixa/g1/abc.jpg')
})

test('comprovante: aceita imagem e PDF até 10MB; recusa vazio, outro formato e grande', () => {
  assert.equal(recusaDoComprovante({ type: 'image/png', size: 10 }), null)
  assert.equal(recusaDoComprovante({ type: 'image/png', size: 0 }), 'Arquivo não enviado')
  assert.equal(recusaDoComprovante({ type: 'text/plain', size: 10 }), 'Formato não suportado. Envie JPG, PNG, WebP ou PDF.')
  assert.equal(recusaDoComprovante({ type: 'application/pdf', size: 11 * 1024 * 1024 }), 'Arquivo muito grande. Máximo: 10MB.')
})

test('loja do lançamento: sócio escolhe; aux_adm só a própria', () => {
  assert.deepEqual(lojaEfetivaDoLancamento({ papel: 'admin_socio', lojaId: null }, 'l2'), { lojaId: 'l2' })
  assert.deepEqual(lojaEfetivaDoLancamento({ papel: 'admin_socio', lojaId: null }, null), { erro: 'Loja inválida' })
  assert.deepEqual(lojaEfetivaDoLancamento({ papel: 'aux_adm', lojaId: 'l1' }, undefined), { lojaId: 'l1' })
  assert.deepEqual(lojaEfetivaDoLancamento({ papel: 'aux_adm', lojaId: 'l1' }, 'l1'), { lojaId: 'l1' })
  assert.deepEqual(lojaEfetivaDoLancamento({ papel: 'aux_adm', lojaId: 'l1' }, 'l2'), { erro: 'Sem permissão para esta loja' })
  assert.deepEqual(lojaEfetivaDoLancamento({ papel: 'aux_adm', lojaId: null }, 'l2'), { erro: 'Loja inválida' })
})
