// Envio do relatório de cartão na /conciliacao (#51): aparece só para quem gere a conciliação, a mesma regra com que
// `importarRelatorio` recusa (importar-relatorio.db.test.ts). A action é a fronteira de fora.
import { test, after, afterEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import { montarDom } from '@/test/montar-dom'
import { montarDialogo } from '@/test/dialogo-em-tela'

const { desmontar: desmontarDom } = montarDom()
after(desmontarDom)

const mocks = [mock.module('../actions', { namedExports: { importarRelatorioAction: async () => ({ ok: true, dados: {} }) } })]
after(() => { for (const m of mocks) m.restore() })

const montados: (() => Promise<void>)[] = []
afterEach(async () => { for (const d of montados.splice(0)) await d() })

const MAQUININHAS = [{ operadora: 'stone', nome: 'Stone' }]
// Booleanos, não elementos: o diff do assert com um elemento do JSDOM leva mais de um minuto para imprimir.
const temImportar = () => [...document.querySelectorAll('button')].some(b => (b.textContent ?? '').trim() === 'Importar')
const temArquivo = () => document.querySelector('input[type="file"]') !== null

test('quem gere a conciliação vê o envio com o Importar; quem não gere não vê nada', async () => {
  const { UploadRelatorio } = await import('./upload-relatorio')
  const comGestao = await montarDialogo(UploadRelatorio, { maquininhas: MAQUININHAS, podeImportar: true })
  montados.push(comGestao.desmontar)
  assert.deepEqual([temImportar(), temArquivo()], [true, true])
  await comGestao.desmontar()

  const semGestao = await montarDialogo(UploadRelatorio, { maquininhas: MAQUININHAS, podeImportar: false })
  montados.push(semGestao.desmontar)
  assert.deepEqual([temImportar(), temArquivo()], [false, false])
})
