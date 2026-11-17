import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validarAcessoFabrica } from './acessos-fabrica'

test('limpa nome e e-mail e aceita senha de 8 ou mais', () => {
  assert.deepEqual(validarAcessoFabrica({ nome: '  Fábrica Comercial  ', email: ' Comercial@MotoChefe.com ', senha: '12345678' }),
    { ok: true, dados: { nome: 'Fábrica Comercial', email: 'comercial@motochefe.com', senha: '12345678' } })
})

test('recusa nome vazio, e-mail inválido e senha curta, com a frase de cada um', () => {
  const erro = (entrada: object) => { const r = validarAcessoFabrica(entrada); assert.equal(r.ok, false); return (r as { erro: string }).erro }
  assert.equal(erro({ nome: '  ', email: 'a@b.co', senha: '12345678' }), 'Informe o nome do acesso.')
  assert.equal(erro({ nome: 'F', email: 'sem-arroba', senha: '12345678' }), 'Informe um e-mail válido para o login.')
  assert.equal(erro({ nome: 'F', email: 'a@b.co', senha: '1234567' }), 'A senha deve ter pelo menos 8 caracteres.')
})

test('só nome, e-mail e senha saem da tela: campos a mais são ignorados e tipo errado é recusado', () => {
  const r = validarAcessoFabrica({ nome: 'F', email: 'a@b.co', senha: '12345678', papel: 'admin_geral', lojaId: 'x', contaId: 'y', modulosExtras: ['pix'] })
  assert.deepEqual(r, { ok: true, dados: { nome: 'F', email: 'a@b.co', senha: '12345678' } })
  assert.equal(validarAcessoFabrica({ nome: ['F'], email: 'a@b.co', senha: '12345678' }).ok, false)
  assert.equal(validarAcessoFabrica(null).ok, false)
})

test('nenhuma frase tem travessão', () => {
  for (const entrada of [{ nome: '', email: '', senha: '' }, { nome: 'F', email: 'x', senha: '' }, { nome: 'F', email: 'a@b.co', senha: '' }]) {
    const r = validarAcessoFabrica(entrada)
    assert.ok(!r.ok && !r.erro.includes('—'))
  }
})
