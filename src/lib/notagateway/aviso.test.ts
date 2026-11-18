import { test } from 'node:test'
import assert from 'node:assert/strict'
import { avisoDeInutilizacao, decidirAviso } from './aviso'

// Formato que o suporte da NG mandou para o aviso de inutilização (comentário na #58).
const AVISO = {
  id: 'mova-31953-1-inut-1', ambienteEmissao: 'Homologacao', status: 'Autorizada', motivoStatus: null, serie: '1',
  numeroInicial: 20, numeroFinal: 20, justificativa: 'Quebra na sequencia da numeracao', protocoloAutorizacao: '353190000062124',
  dataCriacao: '2025-01-03T10:05:47Z', dataUltimaAlteracao: '2025-01-03T10:07:13Z',
}

test('aviso de inutilização: devolve só o id e o ambiente, nada do resultado', () => {
  assert.deepEqual(avisoDeInutilizacao(AVISO), { id: 'mova-31953-1-inut-1', ambienteEmissao: 'Homologacao' })
})

test('aviso com tipo (NF-e ou outro) não é de inutilização, mesmo com os campos dela, e diz que veio com tipo', () => {
  assert.deepEqual(avisoDeInutilizacao({ ...AVISO, tipo: 'NF-e', nfeId: 'mova-31953-1', nfeStatus: 'Autorizada' }), { ignorar: 'aviso com tipo' })
  assert.deepEqual(avisoDeInutilizacao({ ...AVISO, tipo: 'InutilizacaoNumeracaoNFe' }), { ignorar: 'aviso com tipo' })
})

test('corpo sem id, sem numeroInicial, sem numeroFinal, vazio ou que não é objeto: corpo desconhecido', () => {
  const { numeroInicial: _i, ...semInicial } = AVISO
  const { numeroFinal: _f, ...semFinal } = AVISO
  for (const corpo of [{ ...AVISO, id: '' }, { ...AVISO, id: 7 }, semInicial, semFinal, {}, null, 'texto', [AVISO]]) {
    assert.deepEqual(avisoDeInutilizacao(corpo), { ignorar: 'corpo desconhecido' }, JSON.stringify(corpo))
  }
})

test('aviso sem ambienteEmissao vem com ambiente nulo (D1: conta como diferente)', () => {
  const { ambienteEmissao: _a, ...semAmbiente } = AVISO
  assert.deepEqual(avisoDeInutilizacao(semAmbiente), { id: AVISO.id, ambienteEmissao: null })
})

const aviso = { id: AVISO.id, ambienteEmissao: 'Homologacao' }
const pendente = { ambiente: 'Homologacao', situacao: 'pendente' }

test('linha pendente do mesmo ambiente: consulta', () => {
  assert.deepEqual(decidirAviso(aviso, pendente), { acao: 'consultar', linha: pendente })
})

test('id que não existe no banco: ignora', () => {
  assert.deepEqual(decidirAviso(aviso, null), { acao: 'ignorar', motivo: 'id desconhecido' })
})

test('ambiente diferente ou ausente: ignora', () => {
  assert.deepEqual(decidirAviso(aviso, { ...pendente, ambiente: 'Producao' }), { acao: 'ignorar', motivo: 'ambiente diferente' })
  assert.deepEqual(decidirAviso({ ...aviso, ambienteEmissao: null }, pendente), { acao: 'ignorar', motivo: 'ambiente diferente' })
})
