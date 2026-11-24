import { test } from 'node:test'
import assert from 'node:assert/strict'
import { camposDifalIcms, exigeDifal, validarDifalDigitado } from './difal'

test('exemplo da #247: base 9900, interna 12, interestadual 4 e FCP 0 dá DIFAL de 792', () => {
  assert.deepEqual(
    camposDifalIcms({ valor: 9900, aliquotaInterestadual: 4, difal: { aliquotaInterna: 12, percentualFcp: 0 } }),
    {
      baseCalculoUFDestinoDifal: 9900,
      aliquotaUFDestinoDifal: 12,
      valorUFDestinoDifal: 792,
      valorUFOrigemDifal: 0,
      aliquotaInterestadualDifal: 4,
      percentualPartilhaInterestadualDifal: 100,
      baseCalculoFundoCombatePobrezaDifal: 9900,
      percentualFCPDifal: 0,
      valorFCPDifal: 0,
    },
  )
})

test('FCP de 2% sobre 9900 dá 198 e não mexe no DIFAL do destino', () => {
  const c = camposDifalIcms({ valor: 9900, aliquotaInterestadual: 4, difal: { aliquotaInterna: 12, percentualFcp: 2 } })
  assert.equal(c.percentualFCPDifal, 2)
  assert.equal(c.valorFCPDifal, 198)
  assert.equal(c.valorUFDestinoDifal, 792)
})

test('os valores saem arredondados ao centavo', () => {
  // 1234,56 * 8% = 98,7648 e 1234,56 * 1,5% = 18,5184
  const c = camposDifalIcms({ valor: 1234.56, aliquotaInterestadual: 4, difal: { aliquotaInterna: 12, percentualFcp: 1.5 } })
  assert.equal(c.valorUFDestinoDifal, 98.76)
  assert.equal(c.valorFCPDifal, 18.52)
})

test('o DIFAL só vale para venda interestadual a quem não contribui com ICMS', () => {
  assert.equal(exigeDifal({ interestadual: true, indicadorIe: 'nao_contribuinte' }), true)
  // Sem indicador, a nota sai como não contribuinte (payload.ts).
  assert.equal(exigeDifal({ interestadual: true, indicadorIe: null }), true)
  assert.equal(exigeDifal({ interestadual: true, indicadorIe: undefined }), true)
  assert.equal(exigeDifal({ interestadual: true, indicadorIe: 'contribuinte' }), false)
  assert.equal(exigeDifal({ interestadual: true, indicadorIe: 'isento' }), false)
  assert.equal(exigeDifal({ interestadual: false, indicadorIe: 'nao_contribuinte' }), false)
})

test('validar: aceita o número com vírgula ou ponto e FCP vazio vale 0', () => {
  assert.deepEqual(validarDifalDigitado({ aliquotaInterna: '12', fcp: '' }, 4), { ok: true, dados: { aliquotaInterna: 12, percentualFcp: 0 } })
  assert.deepEqual(validarDifalDigitado({ aliquotaInterna: '12,5', fcp: '2' }, 4), { ok: true, dados: { aliquotaInterna: 12.5, percentualFcp: 2 } })
  assert.deepEqual(validarDifalDigitado({ aliquotaInterna: ' 12.5 ', fcp: '0,5' }, 4), { ok: true, dados: { aliquotaInterna: 12.5, percentualFcp: 0.5 } })
})

test('validar: sem a alíquota interna a emissão pede o valor, com frase clara', () => {
  const r = validarDifalDigitado({ aliquotaInterna: '  ', fcp: '' }, 4)
  assert.deepEqual(r, { ok: false, erro: 'Venda para outro estado, para quem não contribui com ICMS: informe a alíquota interna do estado do comprador (e o FCP, se houver).' })
  assert.deepEqual(validarDifalDigitado(undefined, 4), r)
  assert.deepEqual(validarDifalDigitado(null, 4), r)
})

test('validar: recusa número ilegível, negativo, acima de 100 e interna abaixo da interestadual', () => {
  const erro = (entrada: unknown) => {
    const r = validarDifalDigitado(entrada, 4)
    return r.ok ? null : r.erro
  }
  assert.match(erro({ aliquotaInterna: 'abc', fcp: '' })!, /alíquota interna/i)
  assert.match(erro({ aliquotaInterna: '-1', fcp: '' })!, /alíquota interna/i)
  assert.match(erro({ aliquotaInterna: '101', fcp: '' })!, /alíquota interna/i)
  assert.match(erro({ aliquotaInterna: '3', fcp: '' })!, /menor que a interestadual/)
  assert.match(erro({ aliquotaInterna: '12', fcp: 'x' })!, /FCP/)
  assert.match(erro({ aliquotaInterna: '12', fcp: '-2' })!, /FCP/)
  assert.match(erro({ aliquotaInterna: '12', fcp: '101' })!, /FCP/)
})

test('validar: valor que não é texto vindo do navegador é recusado, não convertido', () => {
  assert.equal(validarDifalDigitado({ aliquotaInterna: 12, fcp: '' }, 4).ok, false)
  assert.equal(validarDifalDigitado({ aliquotaInterna: { toString: () => '12' }, fcp: '' }, 4).ok, false)
  assert.equal(validarDifalDigitado('12', 4).ok, false)
})

test('validar: regra do grupo sem alíquota interestadual não dá para calcular', () => {
  const r = validarDifalDigitado({ aliquotaInterna: '12', fcp: '' }, null)
  assert.equal(r.ok, false)
  assert.match(r.ok ? '' : r.erro, /alíquota interestadual/)
})

test('validar: devolve só os dois campos, sem repassar o que o navegador mandou a mais', () => {
  const r = validarDifalDigitado({ aliquotaInterna: '12', fcp: '', valorUFDestinoDifal: 1, grupoId: 'outra-conta' }, 4)
  assert.deepEqual(r, { ok: true, dados: { aliquotaInterna: 12, percentualFcp: 0 } })
})
