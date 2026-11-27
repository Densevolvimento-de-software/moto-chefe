// `after` do Next só funciona dentro de uma requisição; fora dela lança. Nos testes de banco da API a tarefa
// fica guardada e o teste espera por ela, para ver a linha gravada. Mock só da fronteira do Next.
import { mock } from 'node:test'

export async function mockAfterDaResposta() {
  const pendentes: Promise<void>[] = []
  const real = await import('next/server')
  mock.module('next/server', {
    namedExports: {
      ...real,
      after: (tarefa: () => unknown) => { pendentes.push(Promise.resolve().then(tarefa).then(() => undefined)) },
    },
  })
  return { esperarRegistros: async () => { await Promise.all(pendentes.splice(0)) } }
}
