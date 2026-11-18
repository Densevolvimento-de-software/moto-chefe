import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resumoDaRodada, rodarTodosOsGrupos, type ResultadoDoGrupo } from './rodada'
import { ErroMercadoPago } from './cliente'
import { RecusaUsuario } from '@/lib/resultado-action'
import type { ResultadoImportacaoMp } from './importar'

const resultado = (o: Partial<ResultadoImportacaoMp> = {}): ResultadoImportacaoMp =>
  ({ conciliadas: 0, pendentes: 0, duplicadas: 0, estornos: 0, naoTratados: 0, ignorados: 0, ...o })
const grupos = async () => [{ id: 'g1', nome: 'Sul' }, { id: 'g2', nome: 'BH' }, { id: 'g3', nome: 'Vale' }]

test('grupo que falha não impede os seguintes; só a mensagem conhecida sai, o resto vira "erro interno"', async () => {
  const silenciar = console.error
  console.error = () => {}
  try {
    const r = await rodarTodosOsGrupos({
      grupos,
      importar: async id => {
        if (id === 'g1') throw new ErroMercadoPago('Credencial do Mercado Pago recusada (HTTP 401). Cadastre o token novo.', 401)
        if (id === 'g2') throw new Error('falha com TEST-token-123 no meio')
        return resultado({ pendentes: 1 })
      },
    })
    assert.deepEqual(r, [
      { grupo: 'Sul', ok: false, erro: 'Credencial do Mercado Pago recusada (HTTP 401). Cadastre o token novo.' },
      { grupo: 'BH', ok: false, erro: 'erro interno' },
      { grupo: 'Vale', ok: true, resultado: resultado({ pendentes: 1 }) },
    ])
  } finally {
    console.error = silenciar
  }
})

test('recusa do sistema (grupo sem credencial) mantém a frase', async () => {
  const silenciar = console.error
  console.error = () => {}
  try {
    const r = await rodarTodosOsGrupos({
      grupos: async () => [{ id: 'g1', nome: 'Sul' }],
      importar: async () => { throw new RecusaUsuario('Este grupo não tem credencial do Mercado Pago.') },
    })
    assert.deepEqual(r, [{ grupo: 'Sul', ok: false, erro: 'Este grupo não tem credencial do Mercado Pago.' }])
  } finally {
    console.error = silenciar
  }
})

// Decisão D2 do Luis (#51): a resposta do cron traz as contagens e o nome dos grupos que falharam.
test('resumo soma os grupos que importaram e lista pelo nome os que falharam', () => {
  const rs: ResultadoDoGrupo[] = [
    { grupo: 'Sul', ok: true, resultado: resultado({ conciliadas: 2, pendentes: 1, duplicadas: 1, naoTratados: 1 }) },
    { grupo: 'BH', ok: false, erro: 'Credencial do Mercado Pago recusada (HTTP 401). Cadastre o token novo.' },
    { grupo: 'Vale', ok: true, resultado: resultado({ conciliadas: 1, pendentes: 1, estornos: 1, ignorados: 4 }) },
  ]
  assert.deepEqual(resumoDaRodada(rs), {
    grupos: 3, conciliadas: 3, pendentes: 2, duplicadas: 1, estornos: 1, naoTratados: 1, ignorados: 4,
    falhas: 1, gruposComFalha: ['BH'],
  })
})

test('rodada sem grupo: tudo zero', () => {
  assert.deepEqual(resumoDaRodada([]), {
    grupos: 0, conciliadas: 0, pendentes: 0, duplicadas: 0, estornos: 0, naoTratados: 0, ignorados: 0,
    falhas: 0, gruposComFalha: [],
  })
})
