import { test } from 'node:test'
import assert from 'node:assert/strict'
import { temCertificadoBateria } from './certificado-bateria'
import type { LojaParaPainel } from './painel-fabrica'

const LOJA_OK: LojaParaPainel = { ativa: true, fabricaEmail: 'loja@fabrica.invalid', grupoAtivo: true, contaDesativadaEm: null }
const venda = (marca: string | null, loja: Partial<LojaParaPainel> = {}) => ({ marca, loja: { ...LOJA_OK, ...loja } })

test('moto MotoChefe em loja do painel: tem certificado, em qualquer grafia da marca', () => {
  for (const marca of ['MotoChefe', 'MOTO CHEFE', 'Motochéfe']) assert.equal(temCertificadoBateria(venda(marca)), true, marca)
})

test('loja sem e-mail da fábrica (nulo, vazio ou só espaços): sem certificado', () => {
  for (const fabricaEmail of [null, '', '   ']) assert.equal(temCertificadoBateria(venda('MotoChefe', { fabricaEmail })), false, String(fabricaEmail))
})

test('loja inativa, grupo inativo ou Conta desativada: sem certificado, cada um sozinho', () => {
  assert.equal(temCertificadoBateria(venda('MotoChefe', { ativa: false })), false)
  assert.equal(temCertificadoBateria(venda('MotoChefe', { grupoAtivo: false })), false)
  assert.equal(temCertificadoBateria(venda('MotoChefe', { contaDesativadaEm: new Date('2026-10-01T00:00:00Z') })), false)
})

test('moto de outra marca (Voi) em loja do painel, ou sem marca: sem certificado', () => {
  for (const marca of ['Voi', '', null]) assert.equal(temCertificadoBateria(venda(marca)), false, String(marca))
})
