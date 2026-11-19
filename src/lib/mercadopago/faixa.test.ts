import { test } from 'node:test'
import assert from 'node:assert/strict'
import { detalhesDaFaixa, fraseDaFalha, fraseDoNaoTratado, numerosDaFaixa, rotuloDaUltima } from './faixa'
import type { ResultadoImportacaoMp } from './contagens'

const contagens: ResultadoImportacaoMp = { conciliadas: 8, pendentes: 4, duplicadas: 3, estornos: 1, estornosSemLinha: 2, naoTratados: 1, ignorados: 5 }

// V2 aprovada pelo Luis (#51): 4 números; o 4º é "estornadas"; a falha vai como frase, não como número.
test('os 4 números da faixa: novas (já ligadas + para vincular), já estavam, não tratadas (em alerta) e estornadas', () => {
  assert.deepEqual(numerosDaFaixa(contagens), [
    { rotulo: 'vendas novas', valor: 12, nota: '8 já ligadas, 4 para vincular', alerta: false },
    { rotulo: 'já estavam aqui', valor: 3, nota: null, alerta: false },
    { rotulo: 'não tratada', valor: 1, nota: null, alerta: true },
    { rotulo: 'estornada', valor: 1, nota: null, alerta: false },
  ])
  const zero = numerosDaFaixa({ conciliadas: 0, pendentes: 1, duplicadas: 0, estornos: 0, estornosSemLinha: 0, naoTratados: 0, ignorados: 0 })
  assert.deepEqual(zero.map(n => [n.rotulo, n.valor, n.alerta]), [['venda nova', 1, false], ['já estavam aqui', 0, false], ['não tratadas', 0, false], ['estornadas', 0, false]])
})

test('"Ver detalhes" leva as 7 contagens da importação, na ordem da tela', () => {
  assert.deepEqual(detalhesDaFaixa(contagens).map(l => [l.rotulo, l.valor, l.alerta]), [
    ['Vendas novas, já ligadas a uma venda', 8, false],
    ['Vendas novas, para vincular', 4, false],
    ['Já estavam aqui', 3, false],
    ['Marcadas como estornadas', 1, false],
    ['Estornadas antes de chegar aqui', 2, false],
    ['Não tratadas nos últimos 7 dias', 1, true],
    ['Fora da maquininha', 5, false],
  ])
})

// D10: meio fora pede o Forçar; sem líquido entra sozinho numa rodada seguinte.
test('frase do não tratado: meio fora pede o Forçar; sem líquido diz que entra sozinho', () => {
  const meio = fraseDoNaoTratado({ motivo: 'pre_pago', valor: 89.9, data: '2026-11-05' })
  assert.match(meio, /^Cartão pré-pago de R\$\s89,90 em 05\/11\/2026: o MOVA não importa esse meio; concilie a venda com "Forçar"\.$/)
  const semLiquido = fraseDoNaoTratado({ motivo: 'sem_liquido', valor: 80, data: '2026-11-10' })
  assert.match(semLiquido, /^Sem valor líquido, R\$\s80,00 em 10\/11\/2026: entra sozinha quando o Mercado Pago mandar o valor líquido\.$/)
  assert.doesNotMatch(semLiquido, /Forçar/)
})

test('hora da última importação e frase da falha, no horário de Brasília', () => {
  assert.equal(rotuloDaUltima(null), 'Ainda não importado. Roda sozinho uma vez por dia.')
  assert.equal(rotuloDaUltima('2026-11-19T12:02:00.000Z'), 'Importado em 19/11 às 09:02. Roda sozinho uma vez por dia.')
  assert.equal(fraseDaFalha('2026-11-19T12:02:00.000Z', 'O Mercado Pago recusou a credencial deste grupo (HTTP 401). Peça ao administrador para cadastrá-la de novo em Grupos.'),
    'A importação de 19/11 às 09:02 falhou: O Mercado Pago recusou a credencial deste grupo (HTTP 401). Peça ao administrador para cadastrá-la de novo em Grupos.')
})

test('com 1, a faixa fala no singular, também na nota', () => {
  const um = numerosDaFaixa({ conciliadas: 1, pendentes: 0, duplicadas: 1, estornos: 1, estornosSemLinha: 0, naoTratados: 1, ignorados: 0 })
  assert.deepEqual(um.map(n => [n.rotulo, n.nota]), [
    ['venda nova', '1 já ligada, 0 para vincular'], ['já estava aqui', null], ['não tratada', null], ['estornada', null],
  ])
})

// O id cru do meio (account_money) fica no log; a tela diz o que é.
test('meio de pagamento que o MOVA não conhece aparece como "Outro meio de pagamento"', () => {
  assert.match(fraseDoNaoTratado({ motivo: 'outro_meio', valor: 50, data: '2026-11-10' }),
    /^Outro meio de pagamento de R\$\s50,00 em 10\/11\/2026: o MOVA não importa esse meio/)
})
