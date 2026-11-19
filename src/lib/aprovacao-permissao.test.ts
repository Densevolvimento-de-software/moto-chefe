import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  aprovaEmGrupoExtra,
  aprovaPagamentoSensivelNoGrupo,
  socioAprovaNoGrupo,
} from './aprovacao-permissao'

const SUL_DE_MINAS = 'grupo-sdm'
const BH = 'grupo-bh'
const VALE = 'grupo-vale'

test('admin_socio aprova venda do próprio grupo', () => {
  assert.equal(
    socioAprovaNoGrupo({ papel: 'admin_socio', lojaId: 'loja-bh' }, BH, BH),
    true,
  )
})

test('admin_socio não aprova venda de outro grupo', () => {
  assert.equal(
    socioAprovaNoGrupo({ papel: 'admin_socio', lojaId: 'loja-bh' }, SUL_DE_MINAS, BH),
    false,
  )
})

test('sem loja fixa, admin_socio não aprova por grupo', () => {
  assert.equal(
    socioAprovaNoGrupo({ papel: 'admin_socio', lojaId: null }, BH, BH),
    false,
  )
})

test('não-sócio não passa pela regra de grupo', () => {
  assert.equal(
    socioAprovaNoGrupo({ papel: 'aux_adm', lojaId: 'loja-bh' }, BH, BH),
    false,
  )
})

// ─── grupos liberados no cadastro (usuarios.grupos_aprovacao) ─────────────────
// Sócio com loja fixa no Sul de Minas, liberado no BH e no Vale.

const SOCIO_LIBERADO = {
  papel: 'admin_socio',
  lojaId: 'loja-sdm',
  gruposAprovacao: [BH, VALE],
  aprovaPagamentoSensivel: true,
}

test('sócio liberado aprova baixo valor no grupo extra', () => {
  assert.equal(aprovaEmGrupoExtra(SOCIO_LIBERADO, BH), true)
  assert.equal(aprovaEmGrupoExtra(SOCIO_LIBERADO, VALE), true)
})

test('grupo fora da lista não é liberado pelo cadastro', () => {
  // Sul de Minas não está na lista — ele aprova lá pela loja fixa (socioAprovaNoGrupo).
  assert.equal(aprovaEmGrupoExtra(SOCIO_LIBERADO, SUL_DE_MINAS), false)
})

test('grupo extra não vale para papel que não aprova', () => {
  assert.equal(
    aprovaEmGrupoExtra({ ...SOCIO_LIBERADO, papel: 'vendedor' }, BH),
    false,
  )
})

test('sem grupos no cadastro, nada é liberado', () => {
  const socioComum = { papel: 'admin_socio', lojaId: 'loja-x' }
  assert.equal(aprovaEmGrupoExtra(socioComum, BH), false)
})

// ─── financiamento / transferência ────────────────────────────────────────────

test('sócio liberado aprova financiamento no grupo da loja dele e nos grupos extras', () => {
  assert.equal(aprovaPagamentoSensivelNoGrupo(SOCIO_LIBERADO, SUL_DE_MINAS, SUL_DE_MINAS), true)
  assert.equal(aprovaPagamentoSensivelNoGrupo(SOCIO_LIBERADO, BH, SUL_DE_MINAS), true)
  assert.equal(aprovaPagamentoSensivelNoGrupo(SOCIO_LIBERADO, VALE, SUL_DE_MINAS), true)
})

test('sócio sem a liberação não aprova financiamento nem no próprio grupo', () => {
  const socioComum = {
    papel: 'admin_socio',
    lojaId: 'loja-sdm',
    gruposAprovacao: [],
    aprovaPagamentoSensivel: false,
  }
  assert.equal(aprovaPagamentoSensivelNoGrupo(socioComum, SUL_DE_MINAS, SUL_DE_MINAS), false)
})

// admin_geral não ganha financiamento pelo cargo: precisa da liberação no cadastro.
test('guarda: admin_geral sem a liberação não aprova financiamento', () => {
  const outroAdmin = { papel: 'admin_geral', lojaId: null }
  assert.equal(aprovaPagamentoSensivelNoGrupo(outroAdmin, BH, null), false)
})

test('liberação de financiamento não vale fora dos grupos do usuário', () => {
  const soBH = { ...SOCIO_LIBERADO, gruposAprovacao: [BH] }
  assert.equal(aprovaPagamentoSensivelNoGrupo(soBH, VALE, SUL_DE_MINAS), false)
})

test('financiamento não vale para papel que não aprova', () => {
  assert.equal(
    aprovaPagamentoSensivelNoGrupo({ ...SOCIO_LIBERADO, papel: 'aux_adm' }, BH, SUL_DE_MINAS),
    false,
  )
})

test('admin_geral com a liberação aprova financiamento em qualquer grupo, sem loja nem grupos no cadastro (#149)', () => {
  const geral = { papel: 'admin_geral', lojaId: null, gruposAprovacao: [], aprovaPagamentoSensivel: true }
  for (const grupo of [SUL_DE_MINAS, BH, VALE]) assert.equal(aprovaPagamentoSensivelNoGrupo(geral, grupo, null), true, grupo)
})
