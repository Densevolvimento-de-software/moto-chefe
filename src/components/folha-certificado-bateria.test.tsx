// A folha do certificado (edição 2026, MAPFRE): o que sai impresso, lido do HTML que o servidor gera.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { FolhaCertificadoBateria, type DadosDoCertificado } from './folha-certificado-bateria'

const VENDA: DadosDoCertificado = {
  clienteNome: 'Maria Silva', clienteCpf: '529.982.247-25', notaFiscalSaida: '1234',
  marca: 'MotoChefe', modelo: 'X12', cor: 'Preto', lojaNome: 'Loja Exemplo',
}
const folha = (venda: DadosDoCertificado = VENDA) => renderToStaticMarkup(createElement(FolhaCertificadoBateria, { venda }))
const texto = (html: string) => html.replace(/<style[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')
/** O valor escrito sobre a linha de um campo: o texto do `.cert-val` que vem logo depois do rótulo. */
const valorDe = (html: string, rotulo: string) => {
  const m = new RegExp(`${rotulo}:</span><span class="cert-val[^"]*">([^<]*)</span>`).exec(html)
  assert.ok(m, `campo ${rotulo} não está na folha`)
  return m[1]
}

test('texto da edição 2026: MAPFRE e a apólice 3008000014551; nada da edição anterior nem chassi', () => {
  const t = texto(folha())
  assert.match(t, /MAPFRE SEGURADORA, POR MEIO DA APÓLICE Nº 3008000014551/)
  assert.match(t, /SEGURO EXCLUSIVO BATERIAS/)
  assert.doesNotMatch(t, /YELUM|HDI|51\.38\.2025/i)
  assert.doesNotMatch(t, /chassi/i)
})

test('dados da venda preenchidos: nome, documento, NF, marca e modelo, cor e unidade de venda', () => {
  const h = folha()
  assert.equal(valorDe(h, 'NOME COMPLETO'), 'Maria Silva')
  assert.equal(valorDe(h, 'CPF'), '529.982.247-25')
  assert.equal(valorDe(h, 'Nº DA NOTA FISCAL'), '1234')
  assert.equal(valorDe(h, 'MODELO DO VEÍCULO'), 'MotoChefe X12')
  assert.equal(valorDe(h, 'COR DO VEÍCULO'), 'Preto')
  assert.equal(valorDe(h, 'UNIDADE DE VENDA'), 'Loja Exemplo')
})

test('data de nascimento e Nº ID bateria ficam em branco, para preencher à mão', () => {
  const h = folha()
  assert.equal(valorDe(h, 'DATA DE NASCIMENTO'), '')
  assert.equal(valorDe(h, 'Nº ID BATERIA'), '')
})

test('comprador pessoa jurídica: o rótulo vira CNPJ', () => {
  const h = folha({ ...VENDA, clienteNome: 'Transportes Exemplo Ltda', clienteCpf: '12.345.678/0001-90' })
  assert.equal(valorDe(h, 'CNPJ'), '12.345.678/0001-90')
  assert.doesNotMatch(h, /CPF:/)
})

test('venda sem NF: a linha fica em branco, sem travessão', () => {
  const h = folha({ ...VENDA, notaFiscalSaida: null })
  assert.equal(valorDe(h, 'Nº DA NOTA FISCAL'), '')
  assert.doesNotMatch(texto(h), /—/)
})
