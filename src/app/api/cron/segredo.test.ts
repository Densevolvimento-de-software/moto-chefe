import { afterEach, beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { NextRequest } from 'next/server'

// Toda rota que o CRON_SECRET protege recusa antes de qualquer trabalho: sem header ou com o segredo
// errado, 401. O formato aceito (Bearer ou x-cron-secret) está em src/lib/cron-auth.test.ts.
const SEGREDO = 'segredo-do-cron'
beforeEach(() => { process.env.CRON_SECRET = SEGREDO })
afterEach(() => { delete process.env.CRON_SECRET })

type Metodo = 'GET' | 'POST'
type Rota = Partial<Record<Metodo, (req: NextRequest) => Promise<Response> | Response>>
const ROTAS: [string, () => Promise<Rota>, Metodo[]][] = [
  ['/api/cron/avaliacoes-google', () => import('./avaliacoes-google/route'), ['GET']],
  ['/api/cron/log-acoes', () => import('./log-acoes/route'), ['GET']],
  ['/api/cron/mensalidades', () => import('./mensalidades/route'), ['GET']],
  ['/api/cron/notas-contador', () => import('./notas-contador/route'), ['GET']],
  ['/api/cron/pedidos-fabrica', () => import('./pedidos-fabrica/route'), ['GET', 'POST']],
  ['/api/cron/inutilizacoes-pendentes', () => import('./inutilizacoes-pendentes/route'), ['GET']],
  ['/api/conciliacao/cartao', () => import('../conciliacao/cartao/route'), ['POST']],
  ['/api/conciliacao/fila', () => import('../conciliacao/fila/route'), ['GET', 'POST']],
]

for (const [caminho, carregar, metodos] of ROTAS) {
  for (const metodo of metodos) {
    test(`${metodo} ${caminho}: sem o segredo ou com o errado, 401`, async () => {
      const rota = await carregar()
      for (const headers of [{}, { authorization: 'Bearer segredo-do-crom' }, { 'x-cron-secret': 'segredo-do-crom' }] as Record<string, string>[]) {
        const res = await rota[metodo]!(new NextRequest(`http://localhost${caminho}`, { method: metodo, headers }))
        assert.equal(res.status, 401)
        assert.deepEqual(await res.json(), { error: 'Unauthorized' })
      }
    })
  }
}
