import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resumoDaRodada, rodarTodosOsGrupos, type ResultadoDoGrupo } from './rodada'
import { ErroMercadoPago } from './cliente'
import { RecusaUsuario } from '@/lib/resultado-action'
import type { ResultadoImportacaoMp } from './contagens'

const resultado = (o: Partial<ResultadoImportacaoMp> = {}): ResultadoImportacaoMp =>
  ({ conciliadas: 0, pendentes: 0, duplicadas: 0, estornos: 0, estornosSemLinha: 0, naoTratados: 0, ignorados: 0, ...o })
const grupos = async () => [{ id: 'g1', nome: 'Sul' }, { id: 'g2', nome: 'BH' }, { id: 'g3', nome: 'Vale' }]

test('grupo que falha não impede os seguintes; só a mensagem conhecida sai, o resto vira "erro interno"', async t => {
  const log = t.mock.method(console, 'error', () => {})
  const falhas: [string, string][] = []
  const r = await rodarTodosOsGrupos({
    registrarFalha: async (grupoId, erro) => { falhas.push([grupoId, erro]) },
    grupos,
    importar: async id => {
      if (id === 'g1') throw new ErroMercadoPago('O Mercado Pago recusou a credencial deste grupo (HTTP 401). Peça ao administrador para cadastrá-la de novo em Grupos.', 401)
      if (id === 'g2') throw new TypeError('falha com TEST-token-123 no meio')
      return resultado({ pendentes: 1 })
    },
  })
  assert.deepEqual(r, [
    { grupo: 'Sul', ok: false, erro: 'O Mercado Pago recusou a credencial deste grupo (HTTP 401). Peça ao administrador para cadastrá-la de novo em Grupos.' },
    { grupo: 'BH', ok: false, erro: 'erro interno' },
    { grupo: 'Vale', ok: true, resultado: resultado({ pendentes: 1 }) },
  ])
  // A falha de cada grupo fica guardada para a faixa da conciliação, com a mesma frase da resposta.
  assert.deepEqual(falhas, [['g1', 'O Mercado Pago recusou a credencial deste grupo (HTTP 401). Peça ao administrador para cadastrá-la de novo em Grupos.'], ['g2', 'erro interno']])
  // O log do erro desconhecido leva só o nome do erro, como a rotina de inutilização: a mensagem pode ter segredo.
  const linhas = log.mock.calls.map(c => String(c.arguments.join(' ')))
  assert.deepEqual(linhas, [
    '[conciliacao-mercadopago] Sul: O Mercado Pago recusou a credencial deste grupo (HTTP 401). Peça ao administrador para cadastrá-la de novo em Grupos.',
    '[conciliacao-mercadopago] BH: erro interno (TypeError)',
  ])
})

test('recusa do sistema (grupo sem credencial) mantém a frase', async t => {
  t.mock.method(console, 'error', () => {})
  const r = await rodarTodosOsGrupos({
    registrarFalha: async () => {},
    grupos: async () => [{ id: 'g1', nome: 'Sul' }],
    importar: async () => { throw new RecusaUsuario('Este grupo não tem credencial do Mercado Pago.') },
  })
  assert.deepEqual(r, [{ grupo: 'Sul', ok: false, erro: 'Este grupo não tem credencial do Mercado Pago.' }])
})

// Decisão D2 do Luis (#51): a resposta do cron traz as contagens e o nome dos grupos que falharam.
test('resumo soma os grupos que importaram e lista pelo nome os que falharam', () => {
  const rs: ResultadoDoGrupo[] = [
    { grupo: 'Sul', ok: true, resultado: resultado({ conciliadas: 2, pendentes: 1, duplicadas: 1, naoTratados: 1 }) },
    { grupo: 'BH', ok: false, erro: 'O Mercado Pago recusou a credencial deste grupo (HTTP 401). Peça ao administrador para cadastrá-la de novo em Grupos.' },
    { grupo: 'Vale', ok: true, resultado: resultado({ conciliadas: 1, pendentes: 1, estornos: 1, estornosSemLinha: 2, ignorados: 4 }) },
  ]
  assert.deepEqual(resumoDaRodada(rs), {
    grupos: 3, conciliadas: 3, pendentes: 2, duplicadas: 1, estornos: 1, estornosSemLinha: 2, naoTratados: 1, ignorados: 4,
    falhas: 1, gruposComFalha: ['BH'],
  })
})

test('rodada sem grupo: tudo zero', () => {
  assert.deepEqual(resumoDaRodada([]), {
    grupos: 0, conciliadas: 0, pendentes: 0, duplicadas: 0, estornos: 0, estornosSemLinha: 0, naoTratados: 0, ignorados: 0,
    falhas: 0, gruposComFalha: [],
  })
})

test('se gravar a falha também falhar, o grupo seguinte importa do mesmo jeito', async t => {
  const log = t.mock.method(console, 'error', () => {})
  const r = await rodarTodosOsGrupos({
    grupos: async () => [{ id: 'g1', nome: 'Sul' }, { id: 'g2', nome: 'BH' }],
    importar: async id => { if (id === 'g1') throw new ErroMercadoPago('x', 500); return resultado({ pendentes: 1 }) },
    registrarFalha: async () => { throw new TypeError('banco fora') },
  })
  assert.deepEqual(r.map(x => x.ok), [false, true])
  assert.ok(log.mock.calls.some(c => String(c.arguments[0]).includes('falha não registrada (TypeError)')))
})
