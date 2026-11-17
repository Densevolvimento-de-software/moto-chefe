// Guarda das actions só do admin_geral (#3): papel principal, papel extra não abre.
// Mock só na fronteira: a sessão.
import { test, mock } from 'node:test'
import assert from 'node:assert/strict'
import { RecusaUsuario } from './resultado-action'

let sessao: Record<string, unknown> = {}
mock.module('@/lib/auth', { namedExports: { getUsuarioLogado: async () => sessao, isAdmin: (p: string) => p === 'admin_geral' } })

test('admin_geral passa e recebe o usuário da sessão', async () => {
  const { exigirAdminGeral } = await import('./admin-geral')
  sessao = { id: 'g', papel: 'admin_geral', papeisExtras: [] }
  assert.equal((await exigirAdminGeral()).id, 'g')
})

test('outros papéis, e admin_geral só como papel extra, são recusados com "Sem permissão"', async () => {
  const { exigirAdminGeral } = await import('./admin-geral')
  for (const s of [
    { id: 's', papel: 'admin_socio', papeisExtras: [] },
    { id: 'r', papel: 'admin_rede', papeisExtras: [] },
    { id: 'x', papel: 'aux_adm', papeisExtras: ['admin_geral'] },
    { id: 'f', papel: 'fabrica', papeisExtras: [] },
  ]) {
    sessao = s
    await assert.rejects(exigirAdminGeral(), (e: unknown) => e instanceof RecusaUsuario && e.message === 'Sem permissão', s.papel)
  }
})
