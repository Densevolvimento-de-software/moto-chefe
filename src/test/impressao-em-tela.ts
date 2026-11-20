import { after, afterEach } from 'node:test'
import type { montarDom } from '@/test/montar-dom'

/**
 * Janela de impressão nos testes de tela (`abrirImpressao` do simulador): guarda o papel (o HTML do blob)
 * e quantas vezes a janela abriu, sem abrir nada. Chame no topo do arquivo, depois do `montarDom()`.
 */
export function capturarImpressao(dom: ReturnType<typeof montarDom>['dom']) {
  const janelas: string[] = []
  const blobs = new Map<string, Blob>()
  Object.assign(dom.window.URL, {
    createObjectURL: (b: Blob) => { blobs.set('blob:teste', b); return 'blob:teste' },
    revokeObjectURL: () => {},
  })
  dom.window.open = (() => { janelas.push('aberta'); return null }) as typeof dom.window.open
  const globaisAntes = { URL: globalThis.URL, Blob: globalThis.Blob }
  Object.assign(globalThis, { URL: dom.window.URL, Blob: dom.window.Blob })
  after(() => { Object.assign(globalThis, globaisAntes) })
  afterEach(() => { janelas.length = 0; blobs.clear() })
  return {
    janelas,
    /** O HTML que iria para o papel, com os espaços especiais da moeda trocados por espaço comum. */
    papel: async () => (await blobs.get('blob:teste')!.text()).replace(/\s/g, ' '),
  }
}
